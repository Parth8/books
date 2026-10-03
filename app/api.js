// Where the Worker lives (search, covers, accounts, sync): from <meta name="api-base"> in index.html.
// A leaf module with no imports, so anything can use it while the app is still starting.

export const apiBase = (document.querySelector('meta[name="api-base"]')?.content || "").trim().replace(/\/$/, "");
