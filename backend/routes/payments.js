const express = require("express");
const crypto = require("node:crypto");
const { TransactionBuilder, Networks, StrKey } = require("@stellar/stellar-sdk");
const db = require("../db");
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
let veloCheckoutClientPromise;
let veloSdkPromise;

function getVeloSdk() {
  if (!veloSdkPromise) veloSdkPromise = import("@carts1024/velo-sdk");
  return veloSdkPromise;
}

async function getVeloClient() {
  if (!process.env.VELO_GAS_API_KEY) return null;
  if (!veloClientPromise) {
    veloClientPromise = getVeloSdk().then(({ Velo }) => new Velo({
      apiKey: process.env.VELO_GAS_API_KEY,
      baseUrl: process.env.VELO_GAS_BASE_URL || "https://www.velo-build.dev",
      environment: "testnet",
      timeoutMs: 30000,
      maxRetries: 1,
    }));
  }
  return veloClientPromise;
}

async function getVeloCheckoutClient() {
  if (!process.env.VELO_API_KEY) return null;
  if (!veloCheckoutClientPromise) {
    veloCheckoutClientPromise = getVeloSdk().then(({ Velo }) => new Velo({
      apiKey: process.env.VELO_API_KEY,
      baseUrl: process.env.VELO_BASE_URL || undefined,
      environment: "testnet",
      timeoutMs: 30000,
      maxRetries: 1,
    }));
  }
  return veloCheckoutClientPromise;
}

function checkoutCallbackUrl(value, operationId) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return null;
    url.searchParams.set("checkoutOperationId", operationId);
    return url.toString();
  } catch {
    return null;
  }
}

function publicCheckout(checkout) {
  return {
    operationId: checkout.operationId,
    paymentIntentId: checkout.paymentIntentId,
    checkoutUrl: checkout.checkoutUrl || null,
    amount: checkout.amount,
    asset: checkout.asset,
    description: checkout.description,
    status: checkout.status,
    createdAt: checkout.createdAt,
    updatedAt: checkout.updatedAt,
  };
}

function validateNoirTransaction(transactionXdr) {
  if (typeof transactionXdr !== "string" || transactionXdr.length > MAX_XDR_LENGTH) {
    console.warn("[payments] validateNoirTransaction: invalid length or type", { length: transactionXdr?.length });
    return false;
  }

  try {
    const transaction = TransactionBuilder.fromXDR(transactionXdr, Networks.TESTNET);
    if (transaction.operations?.length !== 1 || !transaction.source || !transaction.signatures?.length) {
      console.warn("[payments] validateNoirTransaction: operation count/source/signatures check failed", {
        ops: transaction.operations?.length,
        source: !!transaction.source,
        sigs: transaction.signatures?.length,
      });
      return false;
    }

    const operation = transaction.operations[0];
    const invocation = operation.func?.invokeContract;
    if (
      operation.type !== "invokeHostFunction" ||
      operation.func?.type !== "hostFunctionTypeInvokeContract" ||
      !invocation ||
      operation.source && operation.source !== transaction.source
    ) {
      console.warn("[payments] validateNoirTransaction: operation type/invocation check failed", {
        type: operation.type,
        funcType: operation.func?.type,
        hasInvocation: !!invocation,
        sourceMatch: operation.source === transaction.source,
      });
      return false;
    }

    const contractId = StrKey.encodeContract(Buffer.from(invocation.contractAddress.contractId.value));
    const method = invocation.functionName.toString();
    const valid = NOIR_CONTRACTS.has(contractId) && ALLOWED_METHODS.has(method);
    if (!valid) {
      console.warn("[payments] validateNoirTransaction: contract/method not allowed", { contractId, method, allowedContracts: [...NOIR_CONTRACTS], allowedMethods: [...ALLOWED_METHODS] });
    }
    return valid;
  } catch (err) {
    console.warn("[payments] validateNoirTransaction: exception", { error: err?.message, stack: err?.stack });
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
      veloCheckoutConfigured: Boolean(
        process.env.VELO_API_KEY &&
        process.env.VELO_CHECKOUT_SUCCESS_URL &&
        process.env.VELO_CHECKOUT_CANCEL_URL,
      ),
      veloWebhookConfigured: Boolean(process.env.VELO_WEBHOOK_SECRET),
    },
  });
});

router.post("/checkout-sessions", requireSession, async (req, res) => {
  const { operationId, amount, description } = req.body || {};
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId || "")) {
    return res.status(400).json({ success: false, message: "A valid operation ID is required." });
  }
  if (typeof amount !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/.test(amount) || Number(amount) <= 0) {
    return res.status(400).json({ success: false, message: "Enter a valid XLM amount greater than zero." });
  }
  if (typeof description !== "string" || !description.trim() || description.trim().length > 120) {
    return res.status(400).json({ success: false, message: "A checkout description of up to 120 characters is required." });
  }

  const cleanDescription = description.trim();
  const asset = "native";
  const requestHash = crypto.createHash("sha256")
    .update(JSON.stringify({ amount, asset, description: cleanDescription }))
    .digest("hex");
  const existing = db.payments.findCheckoutByOperationId(operationId);
  if (existing) {
    if (existing.userId !== req.user.id || existing.requestHash !== requestHash) {
      return res.status(409).json({ success: false, message: "This operation ID was already used for a different checkout." });
    }
    return res.json({ success: true, data: publicCheckout(existing) });
  }

  const successUrl = checkoutCallbackUrl(process.env.VELO_CHECKOUT_SUCCESS_URL, operationId);
  const cancelUrl = checkoutCallbackUrl(process.env.VELO_CHECKOUT_CANCEL_URL, operationId);
  if (!successUrl || !cancelUrl) {
    return res.status(503).json({ success: false, message: "Configure valid Velo Testnet checkout success and cancel URLs." });
  }

  const velo = await getVeloCheckoutClient().catch(() => null);
  if (!velo) {
    return res.status(503).json({ success: false, message: "Velo Checkout is not configured. Set a Testnet project API key." });
  }

  try {
    const session = await velo.checkout.sessions.create({
      amount,
      asset,
      description: cleanDescription,
      successUrl,
      cancelUrl,
    }, {
      idempotencyKey: `taskhero:${req.user.id}:${operationId}`,
      correlationId: operationId,
    });
    if (typeof session.paymentIntentId !== "string" || (session.checkoutUrl != null && typeof session.checkoutUrl !== "string")) {
      return res.status(502).json({ success: false, message: "Velo returned an incomplete checkout session." });
    }

    const now = new Date().toISOString();
    const checkout = db.payments.createCheckout({
      operationId,
      userId: req.user.id,
      requestHash,
      paymentIntentId: session.paymentIntentId,
      checkoutUrl: session.checkoutUrl || "",
      amount,
      asset,
      description: cleanDescription,
      status: typeof session.status === "string" ? session.status : "pending",
      createdAt: now,
      updatedAt: now,
    });
    return res.status(201).json({ success: true, data: publicCheckout(checkout) });
  } catch {
    return res.status(502).json({ success: false, message: "Velo could not create this Testnet checkout." });
  }
});

router.get("/checkout-sessions/:operationId", requireSession, async (req, res) => {
  const checkout = db.payments.findCheckoutByOperationId(req.params.operationId);
  if (!checkout || checkout.userId !== req.user.id) {
    return res.status(404).json({ success: false, message: "Checkout not found." });
  }

  const velo = await getVeloCheckoutClient().catch(() => null);
  if (!velo) {
    return res.status(503).json({ success: false, message: "Velo Checkout is not configured." });
  }

  try {
    const paymentIntent = await velo.paymentIntents.retrieve(checkout.paymentIntentId);
    const status = typeof paymentIntent.status === "string" ? paymentIntent.status : checkout.status;
    const updated = db.payments.updateCheckoutStatus(checkout.paymentIntentId, status, new Date().toISOString());
    return res.json({ success: true, data: publicCheckout(updated) });
  } catch {
    return res.status(502).json({ success: false, message: "Velo could not retrieve this payment status." });
  }
});

router.post("/webhook", async (req, res) => {
  if (!process.env.VELO_WEBHOOK_SECRET) {
    return res.status(503).json({ success: false, message: "Velo webhook verification is not configured." });
  }
  if (!Buffer.isBuffer(req.body)) {
    return res.status(400).json({ success: false, message: "A raw JSON webhook body is required." });
  }
  const signature = req.get("x-velo-signature");
  const deliveryId = req.get("x-velo-delivery");
  if (!signature || !deliveryId || deliveryId.length > 200) {
    return res.status(400).json({ success: false, message: "Velo signature and delivery headers are required." });
  }

  let Velo;
  try {
    ({ Velo } = await getVeloSdk());
  } catch {
    return res.status(503).json({ success: false, message: "Velo webhook verification is unavailable." });
  }

  let event;
  try {
    event = await Velo.webhooks.verify({
      payload: req.body.toString("utf8"),
      signature,
      secret: process.env.VELO_WEBHOOK_SECRET,
    });
  } catch {
    return res.status(400).json({ success: false, message: "Velo webhook signature verification failed." });
  }

  if (!event || typeof event.type !== "string") {
    return res.status(400).json({ success: false, message: "Velo webhook event is invalid." });
  }
  const paymentIntentId = typeof event.paymentIntent?.id === "string" ? event.paymentIntent.id : null;
  const status = event.type === "payment.succeeded" ? "succeeded"
    : event.type === "payment.failed" ? "failed"
      : null;
  const receivedAt = new Date().toISOString();
  const inserted = db.payments.recordWebhookDelivery({
    deliveryId,
    eventType: event.type,
    paymentIntentId,
    status,
    receivedAt,
  });
  return res.json({ success: true, received: true, duplicate: !inserted });
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
    console.log("[payments] Submitting Noir transaction:", {
      operationId,
      signedXdrLength: signedXdr?.length || 0,
      signedXdrPreview: signedXdr?.slice(0, 200) + "...",
    });
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
      console.error("[payments] Velo submission failed:", {
        operationId,
        recovery: error?.recovery,
        message: error?.message,
        name: error?.name,
        stack: error?.stack,
      });
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
      return res.status(502).json({ success: false, message: "Velo could not submit this Testnet transaction.", error: error?.message || undefined });
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