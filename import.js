const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const serviceAccount = require("./a.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const rootFolder = path.join(__dirname, "collections");

// Function to parse timestamp strings like "9/30/2025, 2:26:33 PM UTC+7"
function parseTimestampString(timestampStr) {
  try {
    // Replace "UTC+7" with a format that Date can parse (e.g., "+0700")
    const cleanedTimestamp = timestampStr.replace("UTC+7", "+0700");
    const date = new Date(cleanedTimestamp);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid timestamp format: ${timestampStr}`);
    }
    return admin.firestore.Timestamp.fromDate(date);
  } catch (error) {
    console.warn(
      `Failed to parse timestamp "${timestampStr}": ${error.message}`
    );
    return timestampStr; // Fallback to original string if parsing fails
  }
}

// Function to process fields and convert timestamp strings
function processFields(fields) {
  // If fields is an array, return it unchanged to preserve it as an array
  if (Array.isArray(fields)) {
    return fields.map((item) =>
      typeof item === "object" && item !== null
        ? processFields(item) // Recursively process objects within arrays
        : item
    );
  }

  // If fields is an object, process its properties
  if (typeof fields === "object" && fields !== null) {
    const processed = {};
    for (const [key, value] of Object.entries(fields)) {
      if (
        typeof value === "string" &&
        /\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}:\d{2} (AM|PM) UTC\+7/.test(
          value
        )
      ) {
        // Convert timestamp strings
        processed[key] = parseTimestampString(value);
      } else if (typeof value === "object" && value !== null) {
        // Recursively process nested objects or arrays
        processed[key] = processFields(value);
      } else {
        // Keep the value as is
        processed[key] = value;
      }
    }
    return processed;
  }

  // Return non-object values unchanged
  return fields;
}

// Delete collection recursively
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

// Delete all collections
async function deleteAllCollections() {
  const collections = await db.listCollections();
  for (const col of collections) {
    await deleteCollectionRecursive(col);
  }
  console.log("✅ All collections deleted!");
}

// Sync JSON into Firestore with correct hierarchy
async function syncJson(filePath, parentDocRef = null) {
  const colName = path.basename(filePath, ".json");
  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  // If parentDocRef exists → subcollection, otherwise → top-level collection
  const colRef = parentDocRef
    ? parentDocRef.collection(colName)
    : db.collection(colName);

  // Get existing documents
  const snapshot = await colRef.get();
  const existingDocIds = snapshot.docs.map((doc) => doc.id);
  const jsonDocIds = data.map((d) => d.id);

  // Create/update documents
  for (const docData of data) {
    const { id, ...fields } = docData;
    const docRef = colRef.doc(id);
    // Process fields to convert timestamps and preserve arrays
    const processedFields = processFields(fields);
    await docRef.set(processedFields);
    console.log(`Upserted ${docRef.path}`);

    // Check for subcollections (subfolder)
    const docFolder = path.join(path.dirname(filePath), colName, id);
    if (fs.existsSync(docFolder)) {
      const subFiles = fs
        .readdirSync(docFolder)
        .filter((f) => f.endsWith(".json"));
      for (const subFile of subFiles) {
        // Sync subcollections under the parent document
        await syncJson(path.join(docFolder, subFile), docRef);
      }
    }
  }

  // Delete documents not present in JSON
  for (const docId of existingDocIds) {
    if (!jsonDocIds.includes(docId)) {
      await colRef.doc(docId).delete();
      console.log(`Deleted ${colName}/${docId}`);
    }
  }

  console.log(`✅ Synced collection ${colName}`);
}

// Traverse root folder, process only JSON files at root level
function traverseFolder(folderPath) {
  const files = fs.readdirSync(folderPath);
  for (const file of files) {
    const fullPath = path.join(folderPath, file);
    const stat = fs.statSync(fullPath);
    if (stat.isFile() && file.endsWith(".json") && folderPath === rootFolder) {
      syncJson(fullPath); // Process only JSON files in rootFolder (top-level collections)
    } else if (stat.isDirectory()) {
      // Skip recursive traversal; let syncJson handle subcollections
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
