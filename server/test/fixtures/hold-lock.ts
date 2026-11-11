// Opens the database file given as argv[2], takes a write lock and holds it until killed, so a
// test can prove boot refuses a locked database (spec AC7).
import { openDatabase } from "../../src/db.ts";

const file = process.argv[2];
if (!file) throw new Error("usage: hold-lock.ts <database file>");

const db = openDatabase(file);
db.exec("BEGIN IMMEDIATE");
process.stdout.write(JSON.stringify({ level: 30, msg: "holding write lock" }) + "\n");
setInterval(() => {}, 1000);
