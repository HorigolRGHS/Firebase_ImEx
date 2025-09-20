const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const serviceAccount = require("./a.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Thư mục lưu export
const rootFolder = path.join(__dirname, "collections");
fs.mkdirSync(rootFolder, { recursive: true });

async function exportCollection(colRef, folderPath) {
  const snapshot = await colRef.get();
  const colName = colRef.id;

  // Hàm chuyển đổi timestamp sang chuỗi ngày giờ
  function convertTimestamps(obj) {
    if (Array.isArray(obj)) {
      return obj.map(convertTimestamps);
    } else if (obj && typeof obj === "object") {
      const newObj = {};
      for (const key in obj) {
        const val = obj[key];
        if (
          val &&
          typeof val === "object" &&
          typeof val._seconds === "number" &&
          typeof val._nanoseconds === "number"
        ) {
          // Chuyển đổi sang chuỗi ngày giờ quốc tế UTC+7
          const date = new Date(
            val._seconds * 1000 + Math.floor(val._nanoseconds / 1e6)
          );
          newObj[key] =
            date.toLocaleString("en-US", {
              timeZone: "Asia/Bangkok",
              hour12: true,
            }) + " UTC+7";
        } else {
          newObj[key] = convertTimestamps(val);
        }
      }
      return newObj;
    }
    return obj;
  }

  const data = snapshot.docs.map((doc) => {
    const raw = { id: doc.id, ...doc.data() };
    return convertTimestamps(raw);
  });

  // Lưu JSON top-level cho collection
  fs.writeFileSync(
    path.join(folderPath, `${colName}.json`),
    JSON.stringify(data, null, 2)
  );
  console.log(`Exported ${colName}: ${data.length} documents`);

  // Export subcollection
  for (const doc of snapshot.docs) {
    const subCols = await doc.ref.listCollections();
    if (subCols.length > 0) {
      const docFolder = path.join(folderPath, colName, doc.id);
      fs.mkdirSync(docFolder, { recursive: true });

      for (const subCol of subCols) {
        await exportCollection(subCol, docFolder);
      }
    }
  }
}

async function exportAllCollections() {
  const collections = await db.listCollections();
  for (const col of collections) {
    await exportCollection(col, rootFolder);
  }
  console.log("✅ All collections (including subcollections) exported!");
}

exportAllCollections();
