const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const serviceAccount = require("./a.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Thư mục lưu export
const outputFolder = path.join(__dirname, "exported_structure");
fs.mkdirSync(outputFolder, { recursive: true });

// Helper: convert Firestore Timestamp objects to formatted string in Asia/Bangkok (UTC+7)
function formatTimestamp(val) {
  try {
    let date;
    if (val && typeof val.toDate === "function") {
      date = val.toDate();
    } else if (
      val &&
      typeof val === "object" &&
      typeof val._seconds === "number" &&
      typeof val._nanoseconds === "number"
    ) {
      date = new Date(val._seconds * 1000 + Math.floor(val._nanoseconds / 1e6));
    } else {
      return val;
    }

    return (
      date.toLocaleString("en-US", {
        timeZone: "Asia/Bangkok",
        hour12: true,
      }) + " UTC+7"
    );
  } catch (e) {
    return val;
  }
}

// Recursively convert timestamps and normalize sharedWith shape (ensure array)
function convertForExport(obj) {
  if (Array.isArray(obj)) {
    return obj.map(convertForExport);
  }

  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (
        v &&
        typeof v === "object" &&
        (typeof v._seconds === "number" || typeof v.toDate === "function")
      ) {
        out[k] = formatTimestamp(v);
      } else if (k === "sharedWith") {
        // If sharedWith is an object/map, convert to array of keys; if already array, keep it
        if (Array.isArray(v)) {
          out[k] = v.map((it) =>
            typeof it === "object" && it !== null ? convertForExport(it) : it
          );
        } else if (v && typeof v === "object") {
          // Map shape: { 'user@example.com': true } -> [ 'user@example.com' ]
          out[k] = Object.keys(v);
        } else {
          out[k] = v;
        }
      } else {
        out[k] = convertForExport(v);
      }
    }
    return out;
  }

  return obj;
}

// Hàm đệ quy để thu thập dữ liệu từ collection
async function collectCollection(colRef) {
  const snapshot = await colRef.get();
  const colName = colRef.id;
  const collectionData = [];

  for (const doc of snapshot.docs) {
    const raw = { id: doc.id, ...doc.data() };
    const docData = convertForExport(raw);
    // Thu thập subcollections
    const subCols = await doc.ref.listCollections();
    for (const subCol of subCols) {
      const subColData = await collectCollection(subCol);
      if (subColData.length > 0) {
        docData[subCol.id] = subColData;
      }
    }
    collectionData.push(docData);
  }

  return collectionData;
}

// Export toàn bộ cấu trúc thành một file JSON
async function exportDbStructure() {
  const collections = await db.listCollections();
  const dbStructure = {};

  for (const col of collections) {
    const colData = await collectCollection(col);
    if (colData.length > 0) {
      dbStructure[col.id] = colData;
    }
  }

  // Ghi vào file JSON với định dạng pretty-print
  const outputPath = path.join(outputFolder, "db_structure.json");
  fs.writeFileSync(outputPath, JSON.stringify(dbStructure, null, 2));
  console.log(`✅ Exported database structure to ${outputPath}`);
}

// Chạy export
exportDbStructure().catch(console.error);
