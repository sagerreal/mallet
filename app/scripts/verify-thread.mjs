import { chromium } from "@playwright/test";
import { OWNER } from "./e2e-credentials.mjs";
const base = "http://localhost:3000";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1512, height: 950 } });
const log = (s) => console.log("STEP:", s);

await p.goto(base + "/login", { waitUntil: "networkidle" });
await p.getByLabel("Email").fill(OWNER.email);
await p.getByLabel("Password").fill(OWNER.password);
await p.getByRole("button", { name: "Sign in" }).click();
await p.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
await p.goto(base + "/customers", { waitUntil: "networkidle" });
await p.waitForTimeout(1000);

// open Hector Ruiz lead modal, then Text -> Thread
await p.getByText("Hector Ruiz").first().click();
await p.waitForTimeout(500);
await p.getByRole("button", { name: /^Text/ }).click();
await p.waitForTimeout(500);

const bubbles = await p.locator(".overlay.open .thread .msg .bub").count();
const chips = await p.locator(".overlay.open .thread .tsys").count();
await p.screenshot({ path: "/tmp/thread-1-open.png" });
log(`thread open: bubbles=${bubbles} (expect 3), system chips=${chips} (expect >=1 call)`);

// send a text
await p.locator(".overlay.open .composer input").fill("On my way — see you at 11.");
await p.getByRole("button", { name: "Send" }).click();
await p.waitForTimeout(400);
const bubbles2 = await p.locator(".overlay.open .thread .msg .bub").count();
await p.screenshot({ path: "/tmp/thread-2-sent.png" });
log(`after send: bubbles=${bubbles2} (expect 4), last bubble text='${await p.locator(".overlay.open .thread .msg .bub").last().innerText()}'`);

// simulate a reply
await p.getByText("simulate a reply now").click();
await p.waitForTimeout(400);
const bubbles3 = await p.locator(".overlay.open .thread .msg .bub").count();
const lastCls = await p.locator(".overlay.open .thread .msg").last().getAttribute("class");
await p.screenshot({ path: "/tmp/thread-3-reply.png" });
log(`after sim reply: bubbles=${bubbles3} (expect 5), last msg class='${lastCls}' (expect 'msg them')`);

await b.close();
