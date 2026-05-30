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
  descriptionOrAllowedHosts: string | string[] = "",
  allowedHosts: string[] = [],
): Promise<void> {
  const description = Array.isArray(descriptionOrAllowedHosts) ? "" : descriptionOrAllowedHosts;
  const hosts = Array.isArray(descriptionOrAllowedHosts) ? descriptionOrAllowedHosts : allowedHosts;

  return invoke("add_credential", {
    request: { id, name, value, description, allowed_hosts: hosts },
  });
}

export async function updateCredential(
  id: string,
  name?: string,
  value?: string,
  descriptionOrAllowedHosts?: string | string[],
  allowedHosts?: string[],
): Promise<void> {
  const description = Array.isArray(descriptionOrAllowedHosts) ? undefined : descriptionOrAllowedHosts;
  const hosts = Array.isArray(descriptionOrAllowedHosts) ? descriptionOrAllowedHosts : allowedHosts;

  return invoke("update_credential", {
    request: {
      id,
      name: name ?? null,
      value: value ?? null,
      description: description ?? null,
      allowed_hosts: hosts ?? null,
    },
  });
}

export async function removeCredential(id: string): Promise<void> {
  return invoke("remove_credential", { id });
}
