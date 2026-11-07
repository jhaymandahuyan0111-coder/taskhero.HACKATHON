import { useEffect, useRef, useState } from "react";
import { getNetworkDetails, requestAccess, signTransaction } from "@stellar/freighter-api";
import AiChatBot from "./Ai chat bot/AiChatBot.jsx";

const API_BASE = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
  ? "http://localhost:3000/api"
  : "https://task-hero-bu79.onrender.com/api";

function currentUser() {
  if (!localStorage.getItem("taskhero-token")) {
    localStorage.removeItem("taskhero-user");
    return null;
  }
  try {
    return JSON.parse(localStorage.getItem("taskhero-user") || "null");
  } catch {
    localStorage.removeItem("taskhero-user");
    localStorage.removeItem("taskhero-token");
    return null;
  }
}

function go(path) {
  window.location.href = path;
}

function Navigation() {
  const [isDark, setIsDark] = useState(() => document.body.classList.contains("dark-mode"));

  function toggleTheme() {
    const nextIsDark = !document.body.classList.contains("dark-mode");
    document.body.classList.toggle("dark-mode", nextIsDark);
    localStorage.setItem("taskhero-dark-mode", String(nextIsDark));
    setIsDark(nextIsDark);
  }

  return (
    <header className="app-header">
      <nav className="navbar" aria-label="Main navigation">
        <a className="logo" href="index.html" aria-label="TaskHero home">
          <span className="logo-icon" aria-hidden="true">T</span><span>TaskHero</span>
        </a>
        <div className="nav-links">
          <a className="nav-link active" href="index.html" aria-current="page">Browse tasks</a>
          <a className="nav-link" href="my-task.html">My tasks</a>
          <a className="nav-link" href="messeges-page.html">Messages</a>
          <button className="nav-link" type="button" onClick={() => document.getElementById("agent-payments")?.scrollIntoView({ behavior: "smooth" })}>Agent wallet</button>
        </div>
        <div className="nav-actions">
          <a className="primary-button post-task-button" href="post-task.html">Post a task</a>
          <button className="theme-toggle-button" type="button" onClick={toggleTheme} aria-label={`Switch to ${isDark ? "light" : "dark"} mode`} title={`Switch to ${isDark ? "light" : "dark"} mode`}>
            {isDark ? (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" /></svg>
            )}
            <span>{isDark ? "Light" : "Dark"}</span>
          </button>
          <a className="account-link" href="auth.html">Sign in</a>
        </div>
      </nav>
    </header>
  );
}

function AgentPayments({ user }) {
  const librariesRef = useRef(null);
  const [walletAddress, setWalletAddress] = useState("");
  const [deviceHash, setDeviceHash] = useState("");
  const [escrowBalance, setEscrowBalance] = useState(null);
  const [pendingBalance, setPendingBalance] = useState(null);
  const [veloReady, setVeloReady] = useState(false);
  const [checkoutReady, setCheckoutReady] = useState(false);
  const [capXlm, setCapXlm] = useState("1");
  const [fundXlm, setFundXlm] = useState("5");
  const [checkoutAmount, setCheckoutAmount] = useState("10.00");
  const [checkoutDescription, setCheckoutDescription] = useState("TaskHero Testnet checkout");
  const [checkoutOperationId, setCheckoutOperationId] = useState("");
  const [checkoutStatus, setCheckoutStatus] = useState("");
  const [checkoutNotice, setCheckoutNotice] = useState("");
  const [isCheckoutBusy, setIsCheckoutBusy] = useState(false);
  const [merchant, setMerchant] = useState("");
  const [amountXlm, setAmountXlm] = useState("0.25");
  const [paymentNote, setPaymentNote] = useState("");
  const [reviewedPayment, setReviewedPayment] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [isBusy, setIsBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  function getLibraries() {
    if (!librariesRef.current) {
      librariesRef.current = Promise.all([
        import("@noirx402/agent-sdk"),
        import("@stellar/stellar-sdk"),
      ]).then(([noirSdk, stellarSdk]) => ({
        noir: new noirSdk.NoirAgentClient(),
        Asset: stellarSdk.Asset,
        Networks: stellarSdk.Networks,
        StrKey: stellarSdk.StrKey,
        toStroops: noirSdk.toStroops,
        fromStroops: noirSdk.fromStroops,
      }));
    }
    return librariesRef.current;
  }

  async function getNoir() {
    return (await getLibraries()).noir;
  }

  useEffect(() => {
    fetch(`${API_BASE}/payments/config`)
      .then((response) => response.json())
      .then((result) => {
        setVeloReady(Boolean(result.data?.veloGasConfigured));
        setCheckoutReady(Boolean(result.data?.veloCheckoutConfigured && result.data?.veloWebhookConfigured));
      })
      .catch(() => setVeloReady(false));
  }, []);

  async function refreshCheckoutStatus(operationId) {
    const response = await fetch(`${API_BASE}/payments/checkout-sessions/${encodeURIComponent(operationId)}`);
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.data) throw new Error(result?.message || "Unable to check Velo checkout status.");
    setCheckoutOperationId(operationId);
    setCheckoutStatus(result.data.status);
    setCheckoutNotice(result.data.checkoutUrl ? "" : "Velo has not returned a hosted checkout URL yet. Refresh status before creating another checkout.");
  }

  async function createVeloCheckout(event) {
    event.preventDefault();
    setIsCheckoutBusy(true);
    setCheckoutStatus("");
    setCheckoutNotice("");
    try {
      if (!user || !localStorage.getItem("taskhero-token")) throw new Error("Sign in to create a checkout.");
      const operationId = crypto.randomUUID();
      const response = await fetch(`${API_BASE}/payments/checkout-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationId, amount: checkoutAmount, description: checkoutDescription }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.data) {
        throw new Error(result?.message || "Velo could not create this checkout.");
      }
      setCheckoutOperationId(operationId);
      setCheckoutStatus(result.data.status || "pending");
      if (result.data.checkoutUrl) {
        window.location.assign(result.data.checkoutUrl);
      } else {
        setCheckoutNotice("Velo has not returned a hosted checkout URL yet. Refresh status before creating another checkout.");
        setIsCheckoutBusy(false);
      }
    } catch (checkoutError) {
      setCheckoutStatus(checkoutError.message || "Unable to create a Velo checkout.");
      setIsCheckoutBusy(false);
    }
  }

  useEffect(() => {
    const url = new URL(window.location.href);
    const operationId = url.searchParams.get("checkoutOperationId");
    if (!operationId) return;
    url.searchParams.delete("checkoutOperationId");
    window.history.replaceState({}, "", url);
    refreshCheckoutStatus(operationId).catch((statusError) => {
      setCheckoutStatus(statusError.message || "Unable to check Velo checkout status.");
    });
  }, []);

  async function sendSignedTransaction(source, operation) {
    const noir = await getNoir();
    const unsignedXdr = await noir.prepare(source, operation);
    const signed = await signTransaction(unsignedXdr, {
      networkPassphrase: noir.config.networkPassphrase,
      address: source,
    });
    if (signed.error) throw new Error("Wallet signing was cancelled or failed.");
    if (signed.signerAddress && signed.signerAddress !== source) {
      throw new Error("The connected wallet does not match the transaction signer.");
    }
    if (!signed.signedTxXdr) throw new Error("The wallet did not return a signed transaction.");

    const sessionToken = localStorage.getItem("taskhero-token");
    if (!sessionToken) throw new Error("Sign in to TaskHero before submitting a sponsored transaction.");

    const operationId = crypto.randomUUID();
    console.log("[agent-payments] Submitting signed transaction", { operationId, source, operationKind: operation.kind, signedXdrLength: signed.signedTxXdr?.length });
    const response = await fetch(`${API_BASE}/payments/noir/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ operationId, signedXdr: signed.signedTxXdr }),
    });
    const result = await response.json().catch(() => null);
    console.log("[agent-payments] /noir/submit result", { status: response.status, ok: response.ok, result });
    if (!response.ok && response.status !== 202) {
      const msg = result?.error ? `${result.message} - ${result.error}` : (result?.message || "Velo could not submit this transaction.");
      throw new Error(msg);
    }
    let data = result?.data;
    if (!data) throw new Error("Velo returned no transaction receipt.");

    for (let attempt = 0; attempt < 8 && !["succeeded", "failed", "cancelled"].includes(data.status); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const statusResponse = await fetch(`${API_BASE}/payments/noir/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ requestId: data.requestId, transactionHash: data.transactionHash }),
      });
      const statusResult = await statusResponse.json().catch(() => null);
      if (statusResponse.ok && statusResult?.data) data = statusResult.data;
    }

    if (data.status !== "succeeded") {
      setReceipt(data);
      setReviewedPayment(null);
      throw new Error(data.status === "failed" || data.status === "cancelled"
        ? `Transaction ${data.status}. No payment was settled.`
        : "Transaction is still being confirmed. Check its status before trying again.");
    }
    setReceipt(data);
    return data;
  }

  async function syncBalances(address = walletAddress, hash = deviceHash) {
    if (!address) return;
    const { Asset, Networks, fromStroops } = await getLibraries();
    const noir = await getNoir();
    const token = Asset.native().contractId(Networks.TESTNET);
    setPendingBalance(fromStroops(await noir.getPendingBalance(address)));

    let selectedHash = hash;
    if (!selectedHash) {
      const hashes = await noir.listDevices(address);
      for (const candidate of hashes) {
        if (await noir.getDeviceAgent(candidate) === address) {
          selectedHash = candidate;
          break;
        }
      }
    }
    if (!selectedHash || await noir.getDeviceOwner(selectedHash) !== address) {
      setDeviceHash("");
      setEscrowBalance(null);
      return;
    }
    const escrowToken = await noir.getEscrowToken(selectedHash);
    if (escrowToken && escrowToken !== token) throw new Error("This Noir device is funded with a different asset; use a separate device for XLM.");
    setDeviceHash(selectedHash);
    localStorage.setItem(`taskhero-noir-device:${address}`, selectedHash);
    setEscrowBalance(fromStroops(await noir.getEscrowBalance(selectedHash)));
  }

  async function connectWallet() {
    setError("");
    setFeedback("");
    setIsBusy(true);
    try {
      const connected = await requestAccess();
      if (connected.error || !connected.address) throw new Error("Connect a Stellar wallet such as Freighter to continue.");
      const { Networks } = await getLibraries();
      const network = await getNetworkDetails();
      if (network.error || network.networkPassphrase !== Networks.TESTNET) {
        throw new Error("Switch your wallet to Stellar Testnet before continuing.");
      }
      setWalletAddress(connected.address);
      const savedHash = localStorage.getItem(`taskhero-noir-device:${connected.address}`) || "";
      await syncBalances(connected.address, savedHash);
      setFeedback("Wallet connected to Stellar Testnet.");
    } catch (connectError) {
      const message = connectError.message || "Unable to connect this wallet.";
      setError(message.startsWith("Account not found:")
        ? "This Stellar Testnet account is not funded. Request test XLM from Stellar Friendbot, then reconnect."
        : message);
    } finally {
      setIsBusy(false);
    }
  }

  async function createDeviceHash(address) {
    const seed = `taskhero-agent:${address}:${crypto.randomUUID()}`;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function setupAgent() {
    setError("");
    setFeedback("");
    setIsBusy(true);
    try {
      if (!user) throw new Error("Sign in to TaskHero before setting up a payment agent.");
      if (!walletAddress) throw new Error("Connect your Testnet wallet first.");
      const { Asset, Networks, toStroops } = await getLibraries();
      const cap = toStroops(capXlm);
      const funding = toStroops(fundXlm);
      if (cap <= 0n || funding <= 0n) throw new Error("The spending cap and escrow funding must be greater than zero.");

      const noir = await getNoir();
      const token = Asset.native().contractId(Networks.TESTNET);
      let hash = deviceHash;
      if (!hash || await noir.getDeviceOwner(hash) !== walletAddress) {
        hash = await createDeviceHash(walletAddress);
        await sendSignedTransaction(walletAddress, { kind: "registerDevice", deviceHash: hash, agent: walletAddress });
        localStorage.setItem(`taskhero-noir-device:${walletAddress}`, hash);
        setDeviceHash(hash);
      }

      const linkedAgent = await noir.getDeviceAgent(hash);
      if (linkedAgent !== walletAddress) throw new Error("This device is linked to another agent key. Create a new TaskHero agent.");
      let policy = await noir.getPolicy(hash);
      if (policy && policy.agent !== walletAddress) throw new Error("This device has a different authorized agent. Create a new TaskHero agent.");
      if (policy?.expiresAt && policy.expiresAt.getTime() < Date.now()) {
        await sendSignedTransaction(walletAddress, { kind: "revokeAgent", deviceHash: hash });
        policy = null;
      }
      if (policy && policy.maxAmount !== cap) {
        await sendSignedTransaction(walletAddress, { kind: "revokeAgent", deviceHash: hash });
        policy = null;
      }
      if (!policy) {
        await sendSignedTransaction(walletAddress, {
          kind: "registerAgent",
          deviceHash: hash,
          agent: walletAddress,
          asset: token,
          maxAmount: cap,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });
      }

      const escrowToken = await noir.getEscrowToken(hash);
      if (escrowToken && escrowToken !== token) throw new Error("This device's escrow is bound to another asset.");
      await sendSignedTransaction(walletAddress, { kind: "fundEscrow", deviceHash: hash, token, amount: funding });
      await syncBalances(walletAddress, hash);
      setFeedback("Agent registered and escrow funded. Noir can now check XLM requests against the on-chain cap.");
    } catch (setupError) {
      setError(setupError.message || "Unable to set up the agent.");
    } finally {
      setIsBusy(false);
    }
  }

  async function reviewPayment(event) {
    event.preventDefault();
    setError("");
    setFeedback("");
    setReviewedPayment(null);
    try {
      const { Asset, Networks, StrKey, toStroops } = await getLibraries();
      const noir = await getNoir();
      if (!deviceHash || !walletAddress) throw new Error("Connect and set up your agent first.");
      if (!StrKey.isValidEd25519PublicKey(merchant.trim())) throw new Error("Enter a valid Stellar merchant address.");
      if (!paymentNote.trim()) throw new Error("Add a short reason for this payment.");
      const amount = toStroops(amountXlm);
      const check = await noir.checkPayment({
        deviceHash,
        agent: walletAddress,
        asset: Asset.native().contractId(Networks.TESTNET),
        amount,
      });
      if (!check.ok) {
        const reasons = {
          no_agent: "No agent policy is registered for this device.",
          wrong_agent: "This wallet is not the authorized agent.",
          wrong_asset: "The policy does not allow XLM payments.",
          invalid_amount: "Enter an amount greater than zero.",
          over_limit: "This payment exceeds the on-chain per-payment cap.",
          expired: "The agent policy has expired. Set it up again.",
          insufficient_escrow: "The escrow balance is too low. Add Testnet XLM first.",
        };
        throw new Error(reasons[check.reason] || "The Noir policy refused this payment.");
      }
      setReviewedPayment({ merchant: merchant.trim(), amount, note: paymentNote.trim() });
      setFeedback(`Noir policy approved the request for ${amountXlm} XLM.`);
    } catch (reviewError) {
      setError(reviewError.message || "Unable to review this payment.");
    }
  }

  async function approvePayment() {
    if (!reviewedPayment) return;
    setError("");
    setIsBusy(true);
    try {
      const { Asset, Networks, fromStroops } = await getLibraries();
      const receiptData = await sendSignedTransaction(walletAddress, {
        kind: "authorize",
        deviceHash,
        merchant: reviewedPayment.merchant,
        asset: Asset.native().contractId(Networks.TESTNET),
        amount: reviewedPayment.amount,
        nonce: BigInt(Date.now()),
      });
      setReviewedPayment(null);
      await syncBalances();
      const due = await (await getNoir()).getPendingBalance(reviewedPayment.merchant);
      setFeedback(`Payment authorized. ${fromStroops(due)} XLM is now pending for the merchant to claim.`);
      setReceipt(receiptData);
    } catch (paymentError) {
      setError(paymentError.message || "Unable to authorize this payment.");
    } finally {
      setIsBusy(false);
    }
  }

  async function claimPayments() {
    setError("");
    setIsBusy(true);
    try {
      const { Asset, Networks } = await getLibraries();
      const receiptData = await sendSignedTransaction(walletAddress, {
        kind: "claim",
        token: Asset.native().contractId(Networks.TESTNET),
      });
      await syncBalances();
      setFeedback("Claim confirmed on Stellar Testnet. The payment is settled to this wallet.");
      setReceipt(receiptData);
    } catch (claimError) {
      setError(claimError.message || "Unable to claim pending payments.");
    } finally {
      setIsBusy(false);
    }
  }

  async function checkReceipt() {
    if (!receipt?.requestId || !receipt?.transactionHash) return;
    setError("");
    setIsBusy(true);
    try {
      const sessionToken = localStorage.getItem("taskhero-token");
      const response = await fetch(`${API_BASE}/payments/noir/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ requestId: receipt.requestId, transactionHash: receipt.transactionHash }),
      });
      const result = await response.json();
      if (!response.ok || !result.data) throw new Error(result.message || "Unable to check transaction status.");
      setReceipt(result.data);
      if (result.data.status === "succeeded") await syncBalances();
      setFeedback(result.data.status === "succeeded" ? "Transaction confirmed on Stellar Testnet." : `Transaction status: ${result.data.status}.`);
    } catch (statusError) {
      setError(statusError.message || "Unable to check transaction status.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="agent-payments" id="agent-payments" aria-labelledby="agent-payments-title">
      <div className="agent-payments-heading">
        <div>
          <span className="agent-eyebrow">VELO + NOIR | TESTNET</span>
          <h2 id="agent-payments-title">Agent payments</h2>
          <p>Noir checks each request against your on-chain spending rules. Your wallet signs every transaction.</p>
        </div>
        <span className={`velo-status ${veloReady ? "is-ready" : "is-pending"}`}>
          <span aria-hidden="true" /> Velo Gas {veloReady ? "configured" : "setup required"}
        </span>
      </div>

      <div className="agent-payments-grid">
        <section className="agent-payment-panel" aria-labelledby="agent-setup-title">
          <div className="agent-panel-heading">
            <span className="agent-step">01</span>
            <div><h3 id="agent-setup-title">Create a spending rule</h3><p>Register an agent and fund its XLM escrow.</p></div>
          </div>
          <button className="primary-button agent-wallet-button" type="button" onClick={connectWallet} disabled={isBusy}>
            {walletAddress ? `Connected ${walletAddress.slice(0, 5)}...${walletAddress.slice(-4)}` : "Connect Testnet wallet"}
          </button>
          {walletAddress && <div className="agent-wallet-balance">
            <span>Escrow <strong>{escrowBalance ?? "N/A"} XLM</strong></span>
            <span>Pending to you <strong>{pendingBalance ?? "N/A"} XLM</strong></span>
          </div>}
          <div className="agent-form-row">
            <label className="agent-field">Per-payment cap (XLM)
              <input type="number" min="0.0000001" step="0.1" value={capXlm} onChange={(event) => setCapXlm(event.target.value)} />
            </label>
            <label className="agent-field">Fund escrow (XLM)
              <input type="number" min="0.0000001" step="0.1" value={fundXlm} onChange={(event) => setFundXlm(event.target.value)} />
            </label>
          </div>
          <button className="secondary-button agent-wallet-button" type="button" onClick={setupAgent} disabled={isBusy || !walletAddress || !user}>
            {isBusy ? "Waiting for wallet..." : deviceHash ? "Apply rule & add funds" : "Register agent & fund escrow"}
          </button>
          {!user && <p className="agent-help">Sign in to TaskHero to use Velo-sponsored transactions.</p>}
        </section>

        <section className="agent-payment-panel" aria-labelledby="agent-send-title">
          <div className="agent-panel-heading">
            <span className="agent-step">02</span>
            <div><h3 id="agent-send-title">Review a payment request</h3><p>Allowed payments move into Noir escrow, not directly from your wallet.</p></div>
          </div>
          <form className="agent-payment-form" onSubmit={reviewPayment}>
            <label className="agent-field">Merchant Stellar address
              <input value={merchant} onChange={(event) => { setMerchant(event.target.value); setReviewedPayment(null); }} placeholder="G..." autoComplete="off" />
            </label>
            <div className="agent-form-row">
              <label className="agent-field">Amount (XLM)
                <input type="number" min="0.0000001" step="0.01" value={amountXlm} onChange={(event) => { setAmountXlm(event.target.value); setReviewedPayment(null); }} />
              </label>
              <label className="agent-field">Reason
                <input value={paymentNote} onChange={(event) => { setPaymentNote(event.target.value); setReviewedPayment(null); }} placeholder="Task supplies" maxLength={100} />
              </label>
            </div>
            <button className="secondary-button agent-wallet-button" type="submit" disabled={isBusy || !deviceHash}>Check Noir policy</button>
          </form>
          {reviewedPayment && <div className="agent-approval-row">
            <span>Approved by policy - {amountXlm} XLM</span>
            <button className="primary-button" type="button" onClick={approvePayment} disabled={isBusy}>Approve & sign</button>
          </div>}
          {pendingBalance && Number(pendingBalance) > 0 && <button className="agent-claim-button" type="button" onClick={claimPayments} disabled={isBusy}>
            Claim {pendingBalance} XLM to connected wallet
          </button>}
        </section>

        <section className="agent-payment-panel agent-checkout-panel" aria-labelledby="velo-checkout-title">
          <div className="agent-panel-heading">
            <span className="agent-step">03</span>
            <div><h3 id="velo-checkout-title">Velo hosted checkout</h3><p>Open a Testnet XLM checkout and confirm payment status from Velo.</p></div>
          </div>
          <form className="agent-payment-form" onSubmit={createVeloCheckout}>
            <div className="agent-form-row">
              <label className="agent-field">Amount (XLM)
                <input type="number" min="0.0000001" step="0.0000001" value={checkoutAmount} onChange={(event) => setCheckoutAmount(event.target.value)} required />
              </label>
              <label className="agent-field">Description
                <input value={checkoutDescription} onChange={(event) => setCheckoutDescription(event.target.value)} maxLength={120} required />
              </label>
            </div>
            <button className="secondary-button agent-wallet-button" type="submit" disabled={isCheckoutBusy || !checkoutReady || !user}>
              {isCheckoutBusy ? "Opening checkout..." : "Continue to Velo checkout"}
            </button>
          </form>
          {!user && <p className="agent-help">Sign in to create a checkout.</p>}
          {user && !checkoutReady && <p className="agent-help">Configure the Velo project key, callback URLs, and webhook secret in the backend.</p>}
          {checkoutOperationId && <div className="agent-receipt" aria-live="polite">
            <span>Checkout status: {checkoutStatus || "checking"}</span>
            <button type="button" onClick={() => refreshCheckoutStatus(checkoutOperationId).catch((statusError) => setCheckoutStatus(statusError.message))} disabled={isCheckoutBusy}>Refresh</button>
          </div>}
          {checkoutNotice && <p className="agent-help">{checkoutNotice}</p>}
          {checkoutStatus && !checkoutOperationId && <p className="agent-feedback is-error" role="status">{checkoutStatus}</p>}
        </section>
      </div>

      <p className="agent-disclaimer">Testnet only. Escrow funding and payments use test XLM. Anny cannot sign for you; each contract transaction requires wallet approval. Never use a mainnet wallet here.</p>
      {(feedback || error) && <p className={`agent-feedback ${error ? "is-error" : ""}`} role="status">{error || feedback}</p>}
      {receipt && <div className="agent-receipt" aria-live="polite">
        <span>Transaction {receipt.status}</span>
        {receipt.transactionHash && <a href={`https://stellar.expert/explorer/testnet/tx/${receipt.transactionHash}`} target="_blank" rel="noreferrer">View Testnet transaction</a>}
        {!['succeeded', 'failed', 'cancelled'].includes(receipt.status) && <button type="button" onClick={checkReceipt} disabled={isBusy}>Check status</button>}
      </div>}
    </section>
  );
}

function Home() {
  const [tasks, setTasks] = useState([]);
  const [stats, setStats] = useState({});
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [agentPanelVisible, setAgentPanelVisible] = useState(false);
  const user = currentUser();

  async function loadTasks() {
    setLoading(true);
    setError("");
    try {
      const [taskResponse, statsResponse] = await Promise.all([
        fetch(`${API_BASE}/tasks`),
        fetch(`${API_BASE}/tasks/stats`),
      ]);
      const taskResult = await taskResponse.json();
      const statsResult = await statsResponse.json();
      if (!taskResponse.ok || !taskResult.success) throw new Error(taskResult.message || "Unable to load tasks.");
      setTasks(taskResult.data.filter((task) => task.status === "open" && task.poster));
      if (statsResult.success) setStats(statsResult.data);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadTasks(); }, []);

  useEffect(() => {
    const panel = document.getElementById("agent-payments");
    if (!panel || !("IntersectionObserver" in window)) return undefined;
    const observer = new IntersectionObserver(([entry]) => setAgentPanelVisible(entry.isIntersecting), { threshold: 0.1 });
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  const visibleTasks = tasks.filter((task) => {
    const matchesFilter = filter === "all" || task.category === filter;
    const query = search.toLowerCase();
    const matchesSearch = !query || [task.title, task.category, task.location, task.description]
      .some((value) => value.toLowerCase().includes(query));
    return matchesFilter && matchesSearch;
  });

  async function acceptTask(task) {
    if (!user) return go("auth.html?returnTo=index.html");
    const response = await fetch(`${API_BASE}/tasks/${encodeURIComponent(task.id)}/accept`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acceptedBy: user.id }),
    });
    const result = await response.json();
    if (!response.ok || !result.success) return setError(result.message || "Unable to accept task.");
    loadTasks();
  }

  return (
    <>
      <Navigation />
      <AiChatBot isHidden={agentPanelVisible} />
      <section className="page-container">
        <div className="page-header">
          <div>
            <h1>Browse tasks</h1>
            <p className="page-intro">Open requests from people in your area.</p>
          </div>
          <label className="search-box">
            <svg className="search-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3" stroke="currentColor" strokeWidth="1.8" /><path d="m15.5 15.5 4.2 4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            <span className="sr-only">Search tasks</span>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tasks or locations" />
          </label>
        </div>
        <div className="stats-row">
          <div className="stat-item"><div className="stat-number">{stats.openTasks ?? "0"}</div><div className="stat-label">Open tasks</div></div>
          <div className="stat-item"><div className="stat-number">{stats.completedTasks ?? "0"}</div><div className="stat-label">Completed</div></div>
          <div className="stat-item"><div className="stat-number">{stats.activeUsers ?? "0"}</div><div className="stat-label">Active members</div></div>
          <div className="stat-item"><div className="stat-number">{stats.totalPaid == null ? "₱0" : `₱${Number(stats.totalPaid).toLocaleString()}`}</div><div className="stat-label">Paid to helpers</div></div>
        </div>
        <div className="filter-bar" role="group" aria-label="Filter tasks by category">
          {["all", "Image Editing", "Delivery", "Computer / IT", "Cleaning", "Moving", "Graphic Design", "Other"].map((category) => (
            <button key={category} type="button" className={`filter-btn ${filter === category ? "active" : ""}`} aria-pressed={filter === category} onClick={() => setFilter(category)}>{category === "all" ? "All tasks" : category}</button>
          ))}
        </div>
        <div className="results-heading">
          <h2>Available tasks</h2>
          {!loading && !error && <span>{visibleTasks.length} {visibleTasks.length === 1 ? "task" : "tasks"}</span>}
        </div>
        <div className="task-grid" aria-live="polite">
          {loading && <div className="no-results"><span className="loading-indicator" aria-hidden="true" /><h3>Finding available tasks</h3><p>Just a moment while we load the latest listings.</p></div>}
          {error && <div className="no-results"><h3>We could not load tasks</h3><p>{error}</p><button className="secondary-button" type="button" onClick={loadTasks}>Try again</button></div>}
          {!loading && !error && !visibleTasks.length && <div className="no-results"><h3>No tasks match your search</h3><p>Try another keyword or choose a different category.</p></div>}
          {visibleTasks.map((task) => (
            <div className="task-card" key={task.id}>
              <div className="task-card-main">
                <span className="category-tag">{task.category}</span>
                <h3>{task.title}</h3>
                <p className="task-desc">{task.description}</p>
                <div className="task-details">
                  <span><strong>Location</strong>{task.location}</span>
                  <span><strong>Due</strong>{task.deadline || "Flexible"}</span>
                  <span><strong>Posted by</strong>{task.poster.name}</span>
                </div>
              </div>
              <div className="task-card-action">
                <div><span className="budget-label">Budget</span><strong className="task-budget">₱{Number(task.budget).toLocaleString()}</strong></div>
                {user && task.postedBy === user.id
                  ? <button className="accept-button" disabled>Your task</button>
                  : <button className="accept-button" onClick={() => acceptTask(task)}>Accept task</button>}
              </div>
            </div>
          ))}
        </div>
        <AgentPayments user={user} />
      </section>
    </>
  );
}

export default function App() { return <Home />; }
