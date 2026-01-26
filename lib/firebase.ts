import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDpFGkfVl4MrJHXMw4bfXsQPcKwOuNvLoI",
  authDomain: "field-ops-photos.firebaseapp.com",
  projectId: "field-ops-photos",
  storageBucket: "field-ops-photos.appspot.com",
  // appId: "1:102439211879:web:3bea62b0ea9864e29655c2", // optional but recommended
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// IMPORTANT: named Firestore database
export const db = getFirestore(app, "photosites");
