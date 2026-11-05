/**
 * TaskHero — Authentication Controller
 * Handles login / signup, client-side validation, API calls, and UI state.
 */

"use strict";

/* ── CONFIG ────────────────────────────────────────────────── */
const API_BASE = window.TASKHERO_API_BASE;

/* ── DARK MODE (mirror app.js pattern) ────────────────────── */
(function applyDarkMode() {
  if (localStorage.getItem("taskhero-dark-mode") === "true") {
    document.body.classList.add("dark-mode");
  }
})();

/* ── DOM REFS ─────────────────────────────────────────────── */
const authForm     = document.getElementById("authForm");
const authHeading  = document.getElementById("authHeading");
const authSubtitle = document.getElementById("authSubtitle");
const submitBtn    = document.getElementById("submitBtn");
const switchBtn    = document.getElementById("switchBtn");
const switchLine   = document.getElementById("switchLine");
const authError    = document.getElementById("authError");

// Fields
const nameField    = document.getElementById("nameField");
const emailField   = document.getElementById("emailField");
const passwordField= document.getElementById("passwordField");
const confirmField = document.getElementById("confirmField");

const nameInput    = document.getElementById("nameInput");
const emailInput   = document.getElementById("emailInput");
const passwordInput= document.getElementById("passwordInput");
const confirmInput = document.getElementById("confirmInput");

// Field errors
const nameError    = document.getElementById("nameError");
const emailError   = document.getElementById("emailError");
const passwordError= document.getElementById("passwordError");
const confirmError = document.getElementById("confirmError");

// Password toggles
const pwToggle1    = document.getElementById("pwToggle1");
const pwToggle2    = document.getElementById("pwToggle2");

/* ── STATE ────────────────────────────────────────────────── */
const params  = new URLSearchParams(window.location.search);
let isSignup  = params.get("mode") === "signup";
let inFlight  = false;

function safeReturnTo() {
  const requested = params.get("returnTo");
  if (!requested) return "index.html";
  try {
    const destination = new URL(requested, window.location.origin);
    if (destination.origin !== window.location.origin) return "index.html";
    if (destination.pathname === "/" || destination.pathname.endsWith("/home.html")) return "index.html";
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "index.html";
  }
}

/* ── MODE SWITCHING ───────────────────────────────────────── */
function setMode(signup) {
  isSignup = signup;

  // Update heading
  authHeading.textContent  = signup ? "Join TaskHero" : "Welcome back";
  authSubtitle.textContent = signup
    ? "Create an account to post tasks, hire heroes, and build your reputation."
    : "Sign in to manage your tasks and connect with heroes.";

  // Toggle fields
  nameField.classList.toggle("hidden", !signup);
  confirmField.classList.toggle("hidden", !signup);

  nameInput.required    = signup;
  confirmInput.required = signup;
  passwordInput.autocomplete = signup ? "new-password" : "current-password";

  // Update button
  submitBtn.textContent = signup ? "Create account" : "Sign in";

  // Update switch line
  switchLine.innerHTML = signup
    ? `Already have an account? <button type="button" id="switchBtn">Sign in</button>`
    : `Don't have an account? <button type="button" id="switchBtn">Create account</button>`;

  // Clear all errors and inputs
  clearAllErrors();
  clearFormValues();

  // Re-focus first meaningful field
  if (signup) {
    nameInput.focus();
  } else {
    emailInput.focus();
  }
}

function handleModeSwitch() {
  setMode(!isSignup);
}

// Use event delegation so the listener survives innerHTML replacement in setMode
switchLine.addEventListener("click", (e) => {
  if (e.target.id === "switchBtn" || e.target.closest("#switchBtn")) {
    handleModeSwitch();
  }
});

/* ── VALIDATION ───────────────────────────────────────────── */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isLocalAdminLogin() {
  return !isSignup &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
}

function showFieldError(el, msg) {
  el.textContent = msg;
  el.classList.add("visible");
  el.previousElementSibling?.querySelector("input")?.setAttribute("aria-invalid", "true");
}

function clearFieldError(el) {
  el.textContent = "";
  el.classList.remove("visible");
  el.previousElementSibling?.querySelector("input")?.removeAttribute("aria-invalid");
}

function clearAllErrors() {
  [nameError, emailError, passwordError, confirmError].forEach(clearFieldError);
  hideGlobalError();
}

function clearFormValues() {
  nameInput.value    = "";
  emailInput.value   = "";
  passwordInput.value= "";
  confirmInput.value = "";
}

function showGlobalError(msg) {
  authError.textContent = msg;
  authError.classList.add("visible");
  // Trigger shake animation
  authError.classList.remove("shake");
  void authError.offsetWidth; // reflow
  authError.classList.add("shake");
}

function hideGlobalError() {
  authError.textContent = "";
  authError.classList.remove("visible", "shake");
}

/**
 * Validates form and returns { valid: bool, payload: obj|null }
 */
function validateForm() {
  let valid = true;
  clearAllErrors();

  const name     = nameInput.value.trim();
  const email    = emailInput.value.trim();
  const password = passwordInput.value;
  const confirm  = confirmInput.value;

  if (isSignup) {
    if (name.length < 2) {
      showFieldError(nameError, "Name must be at least 2 characters.");
      valid = false;
    }
  }

  if (!EMAIL_RE.test(email) && !isLocalAdminLogin()) {
    showFieldError(emailError, "Enter a valid email address.");
    valid = false;
  }

  if (password.length < 6) {
    showFieldError(passwordError, "Password must be at least 6 characters.");
    valid = false;
  }

  if (isSignup && password !== confirm) {
    showFieldError(confirmError, "Passwords don't match.");
    valid = false;
  }

  const payload = valid
    ? isSignup
      ? { name, email, password }
      : { email, password }
    : null;

  return { valid, payload };
}

/* ── PASSWORD TOGGLES ─────────────────────────────────────── */
function wirePasswordToggle(input, toggleBtn) {
  toggleBtn.addEventListener("click", () => {
    const isHidden = input.type === "password";
    input.type = isHidden ? "text" : "password";
    toggleBtn.textContent = isHidden ? "Hide" : "Show";
    toggleBtn.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
    input.focus();
  });
}

wirePasswordToggle(passwordInput, pwToggle1);
wirePasswordToggle(confirmInput,  pwToggle2);

/* ── LIVE INLINE VALIDATION (on blur) ────────────────────── */
nameInput.addEventListener("blur", () => {
  if (!isSignup) return;
  const v = nameInput.value.trim();
  if (v.length > 0 && v.length < 2) {
    showFieldError(nameError, "Name must be at least 2 characters.");
  } else {
    clearFieldError(nameError);
  }
});

emailInput.addEventListener("blur", () => {
  const v = emailInput.value.trim();
  if (v.length > 0 && !EMAIL_RE.test(v) && !isLocalAdminLogin()) {
    showFieldError(emailError, "Enter a valid email address.");
  } else {
    clearFieldError(emailError);
  }
});

passwordInput.addEventListener("blur", () => {
  const v = passwordInput.value;
  if (v.length > 0 && v.length < 6) {
    showFieldError(passwordError, "Password must be at least 6 characters.");
  } else {
    clearFieldError(passwordError);
  }
});

confirmInput.addEventListener("input", () => {
  if (!isSignup) return;
  const pw  = passwordInput.value;
  const cfw = confirmInput.value;
  if (cfw.length > 0 && cfw !== pw) {
    showFieldError(confirmError, "Passwords don't match.");
  } else {
    clearFieldError(confirmError);
  }
});

/* ── BUTTON STATE ─────────────────────────────────────────── */
function setLoading(loading) {
  inFlight = loading;
  submitBtn.disabled = loading;

  if (loading) {
    const label = isSignup ? "Creating account…" : "Signing in…";
    submitBtn.textContent = label;
  } else {
    submitBtn.textContent = isSignup ? "Create account" : "Sign in";
  }
}

function setSuccess() {
  submitBtn.textContent = isSignup ? "Account created" : "Signed in";
  submitBtn.disabled = true;
}

/* ── FORM SUBMIT ──────────────────────────────────────────── */
authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (inFlight) return;

  const { valid, payload } = validateForm();
  if (!valid) return;

  setLoading(true);
  hideGlobalError();

  const endpoint = isSignup ? "register" : "login";

  try {
    const res = await fetch(`${API_BASE}/users/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await res.json();

    if (!res.ok || !result.success) {
      const msg =
        (Array.isArray(result.errors) && result.errors.length)
          ? result.errors.join(" ")
          : (result.message || "Authentication failed. Please try again.");
      throw new Error(msg);
    }
    if (!result.token) throw new Error("The server did not create a sign-in session.");

    // Success — store user and redirect
    localStorage.setItem("taskhero-user", JSON.stringify(result.data));
    localStorage.setItem("taskhero-token", result.token);

    setSuccess();

    setTimeout(() => {
      window.location.href = safeReturnTo();
    }, 350);

  } catch (err) {
    setLoading(false);

    const isNetworkError =
      err instanceof TypeError &&
      (err.message.includes("Failed to fetch") || err.message.includes("NetworkError") || err.message.includes("fetch"));

    const displayMsg = isNetworkError
      ? "The TaskHero server is offline. Make sure the backend is running."
      : err.message;

    showGlobalError(displayMsg);
  }
});

/* ── INIT ─────────────────────────────────────────────────── */
setMode(isSignup);

// If already logged in, go straight to home (unless we're intentionally on auth)
(function checkAlreadyLoggedIn() {
  try {
    const stored = localStorage.getItem("taskhero-user");
    const token = localStorage.getItem("taskhero-token");
    if (stored && token) {
      const user = JSON.parse(stored);
      if (user?.id && !params.get("mode")) {
        window.location.href = safeReturnTo();
      }
    } else {
      localStorage.removeItem("taskhero-user");
    }
  } catch (_) {
    // Malformed storage — ignore
  }
})();
