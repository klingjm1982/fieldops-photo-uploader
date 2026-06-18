import { createPrivateKey } from "crypto";
import { existsSync, readFileSync } from "fs";
import path from "path";

type ServiceAccount = {
  clientEmail: string;
  privateKey: string;
};

function cleanPrivateKey(value: string) {
  return value
    .trim()
    .replace(/^['"]|['"],?$/g, "")
    .replace(/,\s*$/g, "")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .trim();
}

function isValidPrivateKey(privateKey: string) {
  try {
    createPrivateKey(privateKey);
    return true;
  } catch {
    return false;
  }
}

function readEnvServiceAccount(): ServiceAccount | null {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const rawPrivateKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!clientEmail || !rawPrivateKey) return null;

  const privateKey = cleanPrivateKey(rawPrivateKey);
  if (!isValidPrivateKey(privateKey)) return null;

  return { clientEmail, privateKey };
}

function credentialPaths() {
  return [
    path.join(process.cwd(), "credentials", "service-account.json"),
    path.join(process.cwd(), "fieldops-app", "credentials", "service-account.json"),
  ];
}

function readJsonServiceAccount(): ServiceAccount | null {
  const credentialPath = credentialPaths().find((candidate) => existsSync(candidate));
  if (!credentialPath) return null;

  const serviceAccount = JSON.parse(readFileSync(credentialPath, "utf8")) as {
    client_email?: string;
    private_key?: string;
  };

  if (!serviceAccount.client_email || !serviceAccount.private_key) return null;
  const privateKey = cleanPrivateKey(serviceAccount.private_key);
  if (!isValidPrivateKey(privateKey)) return null;

  return { clientEmail: serviceAccount.client_email, privateKey };
}

export function readServiceAccount() {
  const serviceAccount = readEnvServiceAccount() ?? readJsonServiceAccount();
  if (!serviceAccount) {
    throw new Error("Missing or invalid Google service account credentials");
  }

  return serviceAccount;
}
