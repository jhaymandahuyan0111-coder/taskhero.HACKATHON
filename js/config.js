/* Shared API configuration for local development and GitHub Pages. */
window.TASKHERO_API_BASE = window.TASKHERO_API_BASE || "/api";

const nativeFetch = window.fetch.bind(window);
window.fetch = (input, options = {}) => {
  const requestUrl = new URL(typeof input === "string" ? input : input.url, window.location.href).href;
  const apiUrl = new URL(window.TASKHERO_API_BASE, window.location.href).href;
  if (!requestUrl.startsWith(apiUrl + "/")) return nativeFetch(input, options);

  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(options.headers || {}).forEach((value, name) => headers.set(name, value));
  const token = localStorage.getItem("taskhero-token");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return nativeFetch(input, { ...options, headers }).then((response) => {
    const requestPath = new URL(requestUrl, window.location.href).pathname;
    const isAuthRequest = /\/api\/users\/(login|register)$/.test(requestPath);
    if (response.status === 401 && !isAuthRequest) {
      localStorage.removeItem("taskhero-token");
      localStorage.removeItem("taskhero-user");
      if (!window.location.pathname.endsWith("/auth.html")) {
        const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        window.location.assign(`auth.html?returnTo=${encodeURIComponent(returnTo)}`);
      }
    }
    return response;
  });
};
