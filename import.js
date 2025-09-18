const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const serviceAccount = require("./a.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const rootFolder = path.join(__dirname, "collections");

// Xóa collection đệ quy
async function deleteCollectionRecursive(colRef) {
  const snapshot = await colRef.get();
  for (const doc of snapshot.docs) {
    const subCols = await doc.ref.listCollections();
    for (const subCol of subCols) {
      await deleteCollectionRecursive(subCol);
    }
    await doc.ref.delete();
    console.log(`Deleted doc ${doc.ref.path}`);
  }
  console.log(`Deleted collection ${colRef.id}`);
}

// Xóa tất cả collection
async function deleteAllCollections() {
  const collections = await db.listCollections();
  for (const col of collections) {
    await deleteCollectionRecursive(col);
  }
  console.log("✅ All collections deleted!");
}

// Sync JSON vào Firestore theo hierarchy đúng
async function syncJson(filePath, parentDocRef = null) {
  const colName = path.basename(filePath, ".json");
  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  // Nếu có parentDocRef → subcollection, nếu không → top-level collection
  const colRef = parentDocRef
    ? parentDocRef.collection(colName)
    : db.collection(colName);

  // Lấy doc hiện có
  const snapshot = await colRef.get();
  const existingDocIds = snapshot.docs.map((doc) => doc.id);
  const jsonDocIds = data.map((d) => d.id);

  // Create/update doc
  for (const docData of data) {
    const { id, ...fields } = docData;
    const docRef = colRef.doc(id);
    await docRef.set(fields);
    console.log(`Upserted ${docRef.path}`);

    // Kiểm tra folder con (subcollection)
    const docFolder = path.join(path.dirname(filePath), colName, id);
    if (fs.existsSync(docFolder)) {
      const subFiles = fs
        .readdirSync(docFolder)
        .filter((f) => f.endsWith(".json"));
      for (const subFile of subFiles) {
        // Chỉ sync subcollection trong document cha
        await syncJson(path.join(docFolder, subFile), docRef);
      }
    }
  }

  // Delete doc không còn trong JSON
  for (const docId of existingDocIds) {
    if (!jsonDocIds.includes(docId)) {
      await colRef.doc(docId).delete();
      console.log(`Deleted ${colName}/${docId}`);
    }
  }

  console.log(`✅ Synced collection ${colName}`);
}

// Duyệt folder root, chỉ xử lý file JSON ở cấp root
function traverseFolder(folderPath) {
  const files = fs.readdirSync(folderPath);
  for (const file of files) {
    const fullPath = path.join(folderPath, file);
    const stat = fs.statSync(fullPath);
    if (stat.isFile() && file.endsWith(".json") && folderPath === rootFolder) {
      syncJson(fullPath); // Chỉ xử lý JSON ở rootFolder (top-level collection)
    } else if (stat.isDirectory()) {
      // Không gọi traverseFolder đệ quy, để syncJson xử lý subcollection
      continue;
    }
  }
}

// Start sync
(async () => {
  console.log("🗑️ Deleting all collections...");
  await deleteAllCollections();
  console.log("📂 Importing JSON...");
  traverseFolder(rootFolder);
})();
