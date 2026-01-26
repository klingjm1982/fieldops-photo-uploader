import { signInAnonymously } from "firebase/auth";
import { auth } from "./firebase";

export async function ensureSignedIn() {
  if (auth.currentUser) return auth.currentUser;
  const cred = await signInAnonymously(auth);
  return cred.user;
}
