import { invoke } from "@tauri-apps/api/core";
import type { CredentialMeta } from "../types";

// ── Credential Management ──

export async function listCredentials(): Promise<CredentialMeta[]> {
  return invoke("list_credentials");
}

export async function addCredential(
  id: string,
  name: string,
  value: string,
  allowedHosts: string[],
): Promise<void> {
  return invoke("add_credential", {
    request: { id, name, value, allowed_hosts: allowedHosts },
  });
}

export async function updateCredential(
  id: string,
  name?: string,
  value?: string,
  allowedHosts?: string[],
): Promise<void> {
  return invoke("update_credential", {
    request: {
      id,
      name: name ?? null,
      value: value ?? null,
      allowed_hosts: allowedHosts ?? null,
    },
  });
}

export async function removeCredential(id: string): Promise<void> {
  return invoke("remove_credential", { id });
}
