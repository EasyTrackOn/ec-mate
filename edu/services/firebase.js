// services/firebase.js

// 1. Import the core Firebase App module
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";

// 2. Import core Firestore handlers alongside persistence layout configuration hooks
import { 
  getFirestore, 
  initializeFirestore,       // 🔥 Added to configure custom cache settings
  persistentLocalCache,      // 🔥 Added for IndexedDB disk persistence management
  persistentMultipleTabManager, // 🔥 Added to allow synchronization across open browser tabs
  collection, 
  getDocs, 
  getDoc,
  setDoc,
  query, 
  where, 
  addDoc, 
  updateDoc, 
  doc, 
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// 3. Web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyANTIeJjYPlrxOG9mVmuCUE1HQ0Z7OC5ns",
  authDomain: "ecmate-ae789.firebaseapp.com",
  projectId: "ecmate-ae789",
  storageBucket: "ecmate-ae789.firebasestorage.app",
  messagingSenderId: "177837780988",
  appId: "1:177837780988:web:24f5de6c03c37f6adccc79"
};

// 4. Initialize Firebase Core
const app = initializeApp(firebaseConfig);

// 5. 🔥 INITIALIZE FIRESTORE WITH MULTI-TAB INDEXEDDB PERSISTENCE
// Instead of getFirestore(app), we pass explicit initialization vectors 
// to activate persistent storage automatically in the background.
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager() // Keeps cache in sync across multiple browser tabs
  })
});

// Explicit confirmation listener logging for developers
console.log("🚀 Firestore Native Offline Persistence Layer Activated.");

// 6. Export everything so modules import cleanly
export { 
  app, 
  db, 
  collection, 
  getDocs, 
  getDoc,
  setDoc,
  query, 
  where, 
  addDoc, 
  updateDoc, 
  doc, 
  serverTimestamp,
  writeBatch
};
