import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "dist");
for (const name of ["auth.html", "home.html", "my-task.html", "post-task.html",
  "profile.html", "messeges-page.html", "style.css", "js", "css", "components"]) {
  fs.cpSync(path.join(root, name), path.join(output, name), { recursive: true });
}
console.log("Copied public legacy pages and assets into dist.");
