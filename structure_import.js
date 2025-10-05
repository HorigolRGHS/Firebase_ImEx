const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const serviceAccount = require("./a.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const inputPath = path.join(
  __dirname,
  "exported_structure",
  "db_structure.json"
);

// Parse timestamp strings like "9/30/2025, 2:26:33 PM UTC+7" into Firestore Timestamp
function parseTimestampString(timestampStr) {
  try {
    // Replace "UTC+7" with "+0700" so Date can parse the offset
    const cleaned = timestampStr.replace(/UTC\+7$/, "+0700");
    const date = new Date(cleaned);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid timestamp: ${timestampStr}`);
    }
    return admin.firestore.Timestamp.fromDate(date);
  } catch (e) {
    console.warn(`Failed to parse timestamp '${timestampStr}': ${e.message}`);
    return timestampStr;
  }
}

// Detect timestamp string pattern
const tsRegex = /\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}:\d{2} (AM|PM) UTC\+7$/;

// Recursively process object: convert timestamp strings, ensure arrays preserved, keep sharedWith as array
function processForImport(obj) {
  if (Array.isArray(obj)) {
    return obj.map(processForImport);
  }

  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string" && tsRegex.test(v)) {
        out[k] = parseTimestampString(v);
      } else if (k === "sharedWith") {
        // Ensure sharedWith is an array; if stored as map in older exports, convert keys to array
        if (Array.isArray(v)) {
          out[k] = v;
        } else if (v && typeof v === "object") {
          out[k] = Object.keys(v);
        } else {
          out[k] = v;
        }
      } else if (v && typeof v === "object") {
        out[k] = processForImport(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  return obj;
}

async function importStructure() {
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    return;
  }

  const raw = JSON.parse(fs.readFileSync(inputPath, "utf-8"));

  // raw is an object with top-level collection names
  for (const [colName, docs] of Object.entries(raw)) {
    const colRef = db.collection(colName);
    // For each doc object in array
    for (const docObj of docs) {
      const { id, ...fields } = docObj;
      const processed = processForImport(fields);
      await colRef.doc(id).set(processed);
      console.log(`Upserted ${colName}/${id}`);
    }
  }

  console.log("✅ Import completed");
}

// Run when executed directly
if (require.main === module) {
  importStructure().catch((e) => console.error(e));
}
