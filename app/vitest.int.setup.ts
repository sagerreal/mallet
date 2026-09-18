// Integration tests need real DB credentials. Load them from the gitignored .env.local before
// any module (e.g. the db client, which calls loadConfig at import) is imported.
import { config } from "dotenv";

config({ path: ".env.local" });
