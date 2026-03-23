import { Buffer } from "buffer";
window.Buffer = Buffer;

import {
  Connection,
  PublicKey,
  Transaction,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createApproveInstruction,
  createRevokeInstruction,
  getAccount,
  getMint,
} from "@solana/spl-token";

// --- State ---
let wallet = null;
let activeProvider = null;
let connection = null;
let tokenAccounts = [];

// --- DOM ---
const connectBtn = document.getElementById("connect-btn");
const walletAddr = document.getElementById("wallet-addr");
const mainEl = document.getElementById("main");
const networkSel = document.getElementById("network");
const tokenSel = document.getElementById("token-select");
const tokenInfo = document.getElementById("token-info");
const delegateInput = document.getElementById("delegate-addr");
const amountInput = document.getElementById("amount");
const approveBtn = document.getElementById("approve-btn");
const revokeBtn = document.getElementById("revoke-btn");
const delegationInfo = document.getElementById("delegation-info");
const currentDelegate = document.getElementById("current-delegate");
const currentAmount = document.getElementById("current-amount");
const statusEl = document.getElementById("status");
const walletModal = document.getElementById("wallet-modal");
const walletList = document.getElementById("wallet-list");
const modalClose = document.getElementById("modal-close");
const modalBackdrop = walletModal.querySelector(".modal-backdrop");

// --- Wallet registry ---
const WALLETS = [
  {
    name: "Phantom",
    icon: "https://raw.githubusercontent.com/nickhow/web3-icons/refs/heads/main/src/icons/phantom.svg",
    getProvider: () => window.phantom?.solana?.isPhantom ? window.phantom.solana : null,
    url: "https://phantom.app",
  },
  {
    name: "Solflare",
    icon: "https://raw.githubusercontent.com/nickhow/web3-icons/refs/heads/main/src/icons/solflare.svg",
    getProvider: () => window.solflare?.isSolflare ? window.solflare : null,
    url: "https://solflare.com",
  },
  {
    name: "Backpack",
    icon: "https://raw.githubusercontent.com/nickhow/web3-icons/refs/heads/main/src/icons/backpack.svg",
    getProvider: () => window.backpack?.isBackpack ? window.backpack : null,
    url: "https://backpack.app",
  },
];

function short(addr) {
  const s = addr.toString();
  return s.slice(0, 4) + "..." + s.slice(-4);
}

function showStatus(msg, type = "loading") {
  statusEl.textContent = msg;
  statusEl.className = type;
  statusEl.classList.remove("hidden");
}

function hideStatus() {
  statusEl.classList.add("hidden");
}

function getConnection() {
  const cluster = networkSel.value;
  const rpc =
    cluster === "mainnet-beta"
      ? "https://api.mainnet-beta.solana.com"
      : clusterApiUrl(cluster);
  return new Connection(rpc, "confirmed");
}

// --- Wallet modal ---
function openModal() {
  walletList.innerHTML = "";
  WALLETS.forEach((w) => {
    const btn = document.createElement("button");
    btn.className = "wallet-option";
    const provider = w.getProvider();
    if (!provider) btn.classList.add("not-installed");

    btn.innerHTML = `
      <img src="${w.icon}" alt="${w.name}" />
      <span class="wallet-name">${w.name}</span>
      <span class="wallet-badge">${provider ? "Detected" : "Not installed"}</span>
    `;

    if (provider) {
      btn.addEventListener("click", () => connectWallet(w));
    } else {
      btn.addEventListener("click", () => window.open(w.url, "_blank"));
    }

    walletList.appendChild(btn);
  });
  walletModal.classList.remove("hidden");
}

function closeModal() {
  walletModal.classList.add("hidden");
}

modalClose.addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", closeModal);

async function connectWallet(w) {
  const provider = w.getProvider();
  if (!provider) return;

  try {
    const resp = await provider.connect();
    activeProvider = provider;
    wallet = resp.publicKey;
    connectBtn.textContent = "Disconnect";
    connectBtn.classList.add("connected");
    walletAddr.textContent = short(wallet);
    mainEl.classList.remove("hidden");
    closeModal();
    hideStatus();
    await loadTokenAccounts();
  } catch (err) {
    showStatus("Connection rejected: " + err.message, "error");
  }
}

async function disconnectWallet() {
  if (activeProvider) {
    try { await activeProvider.disconnect(); } catch {}
  }
  activeProvider = null;
  wallet = null;
  connectBtn.textContent = "Connect Wallet";
  connectBtn.classList.remove("connected");
  walletAddr.textContent = "";
  mainEl.classList.add("hidden");
  hideStatus();
}

connectBtn.addEventListener("click", () => {
  if (wallet) {
    disconnectWallet();
  } else {
    openModal();
  }
});

// --- Network change ---
networkSel.addEventListener("change", async () => {
  if (wallet) await loadTokenAccounts();
});

// --- Load token accounts ---
async function loadTokenAccounts() {
  if (!wallet) return;
  connection = getConnection();
  showStatus("Loading token accounts...");

  try {
    const resp = await connection.getParsedTokenAccountsByOwner(wallet, {
      programId: TOKEN_PROGRAM_ID,
    });

    tokenAccounts = resp.value
      .map((item) => {
        const info = item.account.data.parsed.info;
        return {
          address: item.pubkey,
          mint: info.mint,
          balance: info.tokenAmount.uiAmount,
          decimals: info.tokenAmount.decimals,
          delegate: info.delegate || null,
          delegatedAmount: info.delegatedAmount?.uiAmount || 0,
        };
      })
      .filter((t) => t.balance > 0)
      .sort((a, b) => b.balance - a.balance);

    tokenSel.innerHTML = "";
    if (tokenAccounts.length === 0) {
      tokenSel.innerHTML =
        '<option value="">No token accounts found</option>';
      hideStatus();
      return;
    }

    tokenAccounts.forEach((t, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = `${short(t.mint)} — ${t.balance}`;
      tokenSel.appendChild(opt);
    });

    hideStatus();
    updateDelegationInfo();
  } catch (err) {
    showStatus("Failed to load accounts: " + err.message, "error");
  }
}

// --- Show current delegation ---
tokenSel.addEventListener("change", updateDelegationInfo);

function updateDelegationInfo() {
  const idx = tokenSel.value;
  if (idx === "" || !tokenAccounts[idx]) {
    delegationInfo.classList.add("hidden");
    tokenInfo.textContent = "";
    return;
  }

  const t = tokenAccounts[idx];
  tokenInfo.textContent = `Mint: ${t.mint} | Decimals: ${t.decimals}`;

  if (t.delegate) {
    delegationInfo.classList.remove("hidden");
    currentDelegate.textContent = t.delegate;
    currentAmount.textContent = t.delegatedAmount;
  } else {
    delegationInfo.classList.remove("hidden");
    currentDelegate.textContent = "None";
    currentAmount.textContent = "—";
  }
}

// --- Approve ---
approveBtn.addEventListener("click", async () => {
  const idx = tokenSel.value;
  if (idx === "" || !tokenAccounts[idx]) {
    showStatus("Select a token account first.", "error");
    return;
  }

  const delegateAddr = delegateInput.value.trim();
  const amount = parseFloat(amountInput.value);

  if (!delegateAddr) {
    showStatus("Enter a delegate address.", "error");
    return;
  }
  if (isNaN(amount) || amount <= 0) {
    showStatus("Enter a valid amount.", "error");
    return;
  }

  let delegatePubkey;
  try {
    delegatePubkey = new PublicKey(delegateAddr);
  } catch {
    showStatus("Invalid delegate address.", "error");
    return;
  }

  const t = tokenAccounts[idx];
  const rawAmount = BigInt(Math.floor(amount * 10 ** t.decimals));

  showStatus("Requesting approval...");

  try {
    connection = getConnection();
    const ix = createApproveInstruction(
      t.address,
      delegatePubkey,
      wallet,
      rawAmount
    );

    const tx = new Transaction().add(ix);
    tx.feePayer = wallet;
    tx.recentBlockhash = (
      await connection.getLatestBlockhash()
    ).blockhash;

    const signed = await activeProvider.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction(sig, "confirmed");

    showStatus(`Approved! Tx: ${sig}`, "success");
    await loadTokenAccounts();
  } catch (err) {
    showStatus("Approve failed: " + err.message, "error");
  }
});

// --- Revoke ---
revokeBtn.addEventListener("click", async () => {
  const idx = tokenSel.value;
  if (idx === "" || !tokenAccounts[idx]) {
    showStatus("Select a token account first.", "error");
    return;
  }

  const t = tokenAccounts[idx];
  if (!t.delegate) {
    showStatus("No delegate to revoke on this account.", "error");
    return;
  }

  showStatus("Requesting revoke...");

  try {
    connection = getConnection();
    const ix = createRevokeInstruction(t.address, wallet);

    const tx = new Transaction().add(ix);
    tx.feePayer = wallet;
    tx.recentBlockhash = (
      await connection.getLatestBlockhash()
    ).blockhash;

    const signed = await activeProvider.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction(sig, "confirmed");

    showStatus(`Revoked! Tx: ${sig}`, "success");
    await loadTokenAccounts();
  } catch (err) {
    showStatus("Revoke failed: " + err.message, "error");
  }
});
