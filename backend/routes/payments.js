const express = require("express");
const { TransactionBuilder, Networks, StrKey } = require("@stellar/stellar-sdk");
const { requireSession } = require("../auth");

const router = express.Router();
const MAX_XDR_LENGTH = 65536;
const NOIR_CONTRACTS = new Set([
  process.env.NOIR_DEVICE_REGISTRY_CONTRACT || "CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5",
  process.env.NOIR_AGENT_REGISTRY_CONTRACT || "CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV",
  process.env.NOIR_PAYMENT_ESCROW_CONTRACT || "CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS",
]);
const ALLOWED_METHODS = new Set([
  "register", "revoke", "register_agent", "revoke_agent", "fund_escrow",
  "authorize", "claim", "defund_escrow", "sweep_on_revoke",
]);

let veloClientPromise;

async function getVeloClient() {
  if (!process.env.VELO_GAS_API_KEY) return null;
  if (!veloClientPromise) {
    veloClientPromise = import("@carts1024/velo-sdk").then(({ Velo }) => new Velo({
      apiKey: process.env.VELO_GAS_API_KEY,
      baseUrl: process.env.VELO_GAS_BASE_URL || "https://www.velo-build.dev",
      environment: "testnet",
      timeoutMs: 30000,
      maxRetries: 1,
    }));
  }
  return veloClientPromise;
}

function validateNoirTransaction(transactionXdr) {
  if (typeof transactionXdr !== "string" || transactionXdr.length > MAX_XDR_LENGTH) return false;

  try {
    const transaction = TransactionBuilder.fromXDR(transactionXdr, Networks.TESTNET);
    if (transaction.operations?.length !== 1 || !transaction.source || !transaction.signatures?.length) return false;

    const operation = transaction.operations[0];
    const invocation = operation.func?.invokeContract;
    if (
      operation.type !== "invokeHostFunction" ||
      operation.func?.type !== "hostFunctionTypeInvokeContract" ||
      !invocation ||
      operation.source && operation.source !== transaction.source
    ) return false;

    const contractId = StrKey.encodeContract(Buffer.from(invocation.contractAddress.contractId.value));
    const method = invocation.functionName.toString();
    return NOIR_CONTRACTS.has(contractId) && ALLOWED_METHODS.has(method);
  } catch {
    return false;
  }
}

function publicResult(result) {
  return {
    requestId: result.requestId,
    transactionHash: result.transactionHash,
    outerTransactionHash: result.outerTransactionHash || null,
    status: result.status,
    actualFeeStroops: result.actualFeeStroops || null,
    reconciliationRequired: Boolean(result.reconciliationRequired),
  };
}

router.get("/config", (req, res) => {
  res.json({
    success: true,
    data: {
      network: "Stellar Testnet",
      veloGasConfigured: Boolean(process.env.VELO_GAS_API_KEY),
    },
  });
});

router.post("/noir/submit", requireSession, async (req, res) => {
  const { operationId, signedXdr } = req.body || {};
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId || "")) {
    return res.status(400).json({ success: false, message: "A valid operation ID is required." });
  }
  if (!validateNoirTransaction(signedXdr)) {
    return res.status(400).json({ success: false, message: "Only a single signed Noir Testnet contract call can be submitted." });
  }

  const velo = await getVeloClient().catch(() => null);
  if (!velo) {
    return res.status(503).json({ success: false, message: "Velo Gas Station is not configured. Set up a Testnet Gas key and active relayer." });
  }

  try {
    const result = await velo.gas.sponsorAndSubmit(signedXdr, {
      idempotencyKey: `taskhero:${req.user.id}:${operationId}`,
      correlationId: `taskhero:${operationId}`,
    });
    const data = publicResult(result);
    return res.status(result.status === "succeeded" ? 200 : 202).json({
      success: result.status === "succeeded",
      data,
    });
  } catch (error) {
    const recovery = error?.recovery;
    if (recovery?.requestId && recovery?.transactionHash) {
      return res.status(202).json({
        success: true,
        data: {
          requestId: recovery.requestId,
          transactionHash: recovery.transactionHash,
          outerTransactionHash: null,
          status: "submission_unknown",
          actualFeeStroops: null,
          reconciliationRequired: true,
        },
      });
    }
    return res.status(502).json({ success: false, message: "Velo could not submit this Testnet transaction." });
  }
});

router.post("/noir/status", requireSession, async (req, res) => {
  const { requestId, transactionHash } = req.body || {};
  if (
    typeof requestId !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(requestId) ||
    typeof transactionHash !== "string" || !/^[a-f0-9]{64}$/i.test(transactionHash)
  ) {
    return res.status(400).json({ success: false, message: "A valid Velo transaction identity is required." });
  }

  const velo = await getVeloClient().catch(() => null);
  if (!velo) {
    return res.status(503).json({ success: false, message: "Velo Gas Station is not configured." });
  }

  try {
    const result = await velo.gas.getStatus({ requestId, transactionHash });
    return res.json({ success: result.status === "succeeded", data: publicResult(result) });
  } catch {
    return res.status(502).json({ success: false, message: "Velo could not check this transaction yet." });
  }
});

module.exports = router;