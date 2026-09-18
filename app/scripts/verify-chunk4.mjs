import { chromium } from "@playwright/test";
import { OWNER } from "./e2e-credentials.mjs";
const base = "http://localhost:3000";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1512, height: 950 } });
const log = (s) => console.log("STEP:", s);
async function login(){ await p.goto(base+"/login",{waitUntil:"networkidle"}); await p.getByLabel("Email").fill(OWNER.email); await p.getByLabel("Password").fill(OWNER.password); await p.getByRole("button",{name:"Sign in"}).click(); await p.waitForURL(u=>!u.pathname.includes("/login"),{timeout:30000}); }
await login();

// --- TECH quote GBB + sign ---
await p.goto(base+"/my-day",{waitUntil:"networkidle"}); await p.waitForTimeout(800);
await p.locator(".md-stop").first().click(); await p.waitForTimeout(600);
let m = p.locator(".overlay.open");
// open the tech quote builder via Pricing "re-price" (Sofia is priced)
await m.getByRole("button",{name:/re-price|Price it on site/}).first().click(); await p.waitForTimeout(600);
m = p.locator(".overlay.open");
const edit = await m.getByText("Build the price").count();
const seeded = await m.locator(".card input[type='number']").count();
log(`tq edit mode=${edit}, seeded line inputs=${seeded}`);
await p.screenshot({path:"/tmp/chunk4-edit.png"});
// add a cheaper option → tier chips
const cheaper = m.getByRole("button",{name:/Add a cheaper option/}).first();
if (await cheaper.count()) { await cheaper.click(); await p.waitForTimeout(400); }
const chips = await m.locator(".chips .chip").count();
log(`tier chips after opt-in=${chips}`);
// present
await m.getByRole("button",{name:/Present/}).first().click(); await p.waitForTimeout(500);
const present = await m.getByText(/Present — on glass/).count();
log(`present mode=${present}`);
await p.screenshot({path:"/tmp/chunk4-present.png"});
// choose Better card → sign
await m.locator(".card.clickable").filter({hasText:/Better|recommended/}).first().click(); await p.waitForTimeout(500);
const sign = await m.getByText(/Approve & sign|Approve .* sign/).count();
const hasCanvas = await m.locator("canvas").count();
const acceptBtn = await m.getByRole("button",{name:/Accept & sign|Accept .* sign/}).count();
log(`sign mode=${sign}, canvas=${hasCanvas}, accept btn=${acceptBtn}`);
await p.screenshot({path:"/tmp/chunk4-sign.png"});
// draw on canvas then accept
const cv = m.locator("canvas").first();
const box = await cv.boundingBox();
if (box) { await p.mouse.move(box.x+60, box.y+80); await p.mouse.down(); await p.mouse.move(box.x+200, box.y+40); await p.mouse.move(box.x+320, box.y+100); await p.mouse.up(); await p.waitForTimeout(200); }
await m.getByRole("button",{name:/Accept & sign|Accept .* sign/}).first().click(); await p.waitForTimeout(600);
const closed = await p.locator(".overlay.open").getByText(/Approve & sign/).count();
log(`after accept, sign-sheet gone=${closed===0}`);
await p.screenshot({path:"/tmp/chunk4-signed.png"});
await b.close();
