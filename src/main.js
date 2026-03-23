import "./polyfills.js";

import {
  Connection,
  PublicKey,
  Transaction,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createApproveInstruction,
  createRevokeInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getMint,
  ASSOCIATED_TOKEN_PROGRAM_ID,
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
const delegationsSection = document.getElementById("delegations-section");
const delegationsList = document.getElementById("delegations-list");
const noDelegations = document.getElementById("no-delegations");
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
    getProvider: () => window.solflare ? window.solflare : null,
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

const HELIUS_KEY = "04909b63-2f46-4559-943f-706616fb46f6";

function getConnection() {
  const cluster = networkSel.value;
  const rpc =
    cluster === "mainnet-beta"
      ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`
      : `https://devnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
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
    wallet = resp?.publicKey || provider.publicKey;
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
    const [legacyResp, token2022Resp] = await Promise.all([
      connection.getParsedTokenAccountsByOwner(wallet, {
        programId: TOKEN_PROGRAM_ID,
      }),
      connection.getParsedTokenAccountsByOwner(wallet, {
        programId: TOKEN_2022_PROGRAM_ID,
      }),
    ]);

    const allAccounts = [...legacyResp.value, ...token2022Resp.value];

    tokenAccounts = allAccounts
      .map((item) => {
        const info = item.account.data.parsed.info;
        const ownerStr = item.account.owner.toString();
        const programId =
          ownerStr === TOKEN_2022_PROGRAM_ID.toString()
            ? TOKEN_2022_PROGRAM_ID
            : TOKEN_PROGRAM_ID;
        const delAmt = info.delegatedAmount;
        return {
          address: item.pubkey,
          mint: info.mint,
          balance: info.tokenAmount.uiAmount,
          decimals: info.tokenAmount.decimals,
          delegate: info.delegate || null,
          delegatedAmount:
            typeof delAmt === "object" ? delAmt?.uiAmount || 0 : Number(delAmt) || 0,
          programId,
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
    renderDelegationsList();
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

// --- Delegations list ---
function renderDelegationsList() {
  const delegated = tokenAccounts.filter((t) => t.delegate);
  delegationsSection.classList.remove("hidden");
  delegationsList.innerHTML = "";

  if (delegated.length === 0) {
    noDelegations.classList.remove("hidden");
    return;
  }

  noDelegations.classList.add("hidden");

  delegated.forEach((t) => {
    const row = document.createElement("div");
    row.className = "delegation-row";
    row.innerHTML = `
      <div class="del-header">
        <span class="del-mint">${short(t.mint)}</span>
        <button class="revoke-btn">Revoke</button>
      </div>
      <div class="del-details">
        <div>Delegate: <span>${short(t.delegate)}</span></div>
        <div>Approved: <span>${t.delegatedAmount}</span> / Balance: <span>${t.balance}</span></div>
        <div>Mint: <span>${t.mint}</span></div>
      </div>
    `;

    row.querySelector(".revoke-btn").addEventListener("click", () => revokeByAccount(t));
    delegationsList.appendChild(row);
  });
}

async function revokeByAccount(t) {
  showStatus(`Revoking delegate on ${short(t.mint)}...`);

  try {
    connection = getConnection();
    const ix = createRevokeInstruction(t.address, wallet, [], t.programId);

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
      rawAmount,
      [],
      t.programId
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
    const ix = createRevokeInstruction(t.address, wallet, [], t.programId);

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

// --- Transfer as Delegate ---
const sourceOwnerInput = document.getElementById("source-owner");
const sourceMintInput = document.getElementById("source-mint");
const transferAmountInput = document.getElementById("transfer-amount");
const destAddrInput = document.getElementById("dest-addr");
const lookupBtn = document.getElementById("lookup-btn");
const incomingDelegations = document.getElementById("incoming-delegations");
const delegateTransferBtn = document.getElementById("delegate-transfer-btn");

// Lookup all token accounts that have delegated to the connected wallet
lookupBtn.addEventListener("click", async () => {
  if (!wallet) {
    showStatus("Connect wallet first.", "error");
    return;
  }

  connection = getConnection();
  showStatus("Searching for delegations to your wallet...");
  incomingDelegations.innerHTML = "";

  try {
    // Use getProgramAccounts with delegate filter for both programs
    const delegateBase58 = wallet.toBase58();
    const results = [];

    for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      const accounts = await connection.getParsedProgramAccounts(programId, {
        filters: [
          { dataSize: programId.equals(TOKEN_PROGRAM_ID) ? 165 : undefined },
          {
            memcmp: {
              offset: 76,
              bytes: delegateBase58,
            },
          },
        ].filter((f) => f.dataSize !== undefined || f.memcmp),
      });

      for (const acc of accounts) {
        const info = acc.account.data.parsed?.info;
        if (!info) continue;
        results.push({
          address: acc.pubkey,
          owner: info.owner,
          mint: info.mint,
          delegate: info.delegate,
          delegatedAmount:
            typeof info.delegatedAmount === "object"
              ? info.delegatedAmount?.uiAmount || 0
              : Number(info.delegatedAmount) || 0,
          decimals: info.tokenAmount?.decimals || 0,
          balance: info.tokenAmount?.uiAmount || 0,
          programId,
        });
      }
    }

    if (results.length === 0) {
      incomingDelegations.innerHTML =
        '<p class="sub">No accounts have delegated to your wallet.</p>';
      hideStatus();
      return;
    }

    results.forEach((r) => {
      const row = document.createElement("div");
      row.className = "incoming-row";
      row.innerHTML = `
        <div class="inc-info">
          <div>Owner: <span>${short(r.owner)}</span></div>
          <div>Mint: <span>${short(r.mint)}</span></div>
          <div>Approved: <span>${r.delegatedAmount}</span> / Balance: <span>${r.balance}</span></div>
        </div>
        <span class="inc-badge">Select</span>
      `;
      row.addEventListener("click", () => {
        sourceOwnerInput.value = r.owner;
        sourceMintInput.value = r.mint;
        transferAmountInput.value = r.delegatedAmount;
        showStatus(`Selected: ${r.delegatedAmount} of ${short(r.mint)} from ${short(r.owner)}`, "success");
      });
      incomingDelegations.appendChild(row);
    });

    showStatus(`Found ${results.length} delegation(s) to your wallet.`, "success");
  } catch (err) {
    showStatus("Lookup failed: " + err.message, "error");
  }
});

// Execute transfer as delegate
delegateTransferBtn.addEventListener("click", async () => {
  if (!wallet) {
    showStatus("Connect wallet first.", "error");
    return;
  }

  const sourceOwner = sourceOwnerInput.value.trim();
  const mintAddr = sourceMintInput.value.trim();
  const amount = parseFloat(transferAmountInput.value);
  const destAddr = destAddrInput.value.trim() || wallet.toBase58();

  if (!sourceOwner || !mintAddr) {
    showStatus("Enter source owner and mint address.", "error");
    return;
  }
  if (isNaN(amount) || amount <= 0) {
    showStatus("Enter a valid amount.", "error");
    return;
  }

  let sourceOwnerPk, mintPk, destPk;
  try {
    sourceOwnerPk = new PublicKey(sourceOwner);
    mintPk = new PublicKey(mintAddr);
    destPk = new PublicKey(destAddr);
  } catch {
    showStatus("Invalid address.", "error");
    return;
  }

  showStatus("Preparing delegate transfer...");

  try {
    connection = getConnection();

    // Determine which program the mint belongs to
    const mintAccountInfo = await connection.getAccountInfo(mintPk);
    const mintProgramId = mintAccountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    // Get mint info for decimals
    const mintInfo = await getMint(connection, mintPk, "confirmed", mintProgramId);
    const decimals = mintInfo.decimals;
    const rawAmount = BigInt(Math.floor(amount * 10 ** decimals));

    // Source token account (owner's ATA)
    const sourceAta = getAssociatedTokenAddressSync(
      mintPk,
      sourceOwnerPk,
      true,
      mintProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Destination token account (recipient's ATA)
    const destAta = getAssociatedTokenAddressSync(
      mintPk,
      destPk,
      true,
      mintProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const tx = new Transaction();

    // Create destination ATA if it doesn't exist
    const destAtaInfo = await connection.getAccountInfo(destAta);
    if (!destAtaInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          wallet,
          destAta,
          destPk,
          mintPk,
          mintProgramId,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }

    // Transfer as delegate
    tx.add(
      createTransferCheckedInstruction(
        sourceAta,
        mintPk,
        destAta,
        wallet, // delegate is the signer
        rawAmount,
        decimals,
        [],
        mintProgramId
      )
    );

    tx.feePayer = wallet;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    const signed = await activeProvider.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction(sig, "confirmed");

    showStatus(`Transfer complete! Tx: ${sig}`, "success");
    await loadTokenAccounts();
  } catch (err) {
    showStatus("Transfer failed: " + err.message, "error");
  }
});
