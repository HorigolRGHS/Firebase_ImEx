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

  const data = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

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
