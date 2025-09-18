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

// Hàm đệ quy để thu thập dữ liệu từ collection
async function collectCollection(colRef) {
  const snapshot = await colRef.get();
  const colName = colRef.id;
  const collectionData = [];

  for (const doc of snapshot.docs) {
    const docData = { id: doc.id, ...doc.data() };
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
