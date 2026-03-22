import { invoke } from "@tauri-apps/api/core";
import type {
  CronJob,
  CronRun,
  CreateCronJobRequest,
  UpdateCronJobRequest,
} from "../types";

// ── Cron Jobs ──

export async function listCronJobs(): Promise<CronJob[]> {
  return invoke("list_cron_jobs");
}

export async function listCronJobsForAgent(agentId: string): Promise<CronJob[]> {
  return invoke("list_cron_jobs_for_agent", { agentId });
}

export async function createCronJob(request: CreateCronJobRequest): Promise<CronJob> {
  return invoke("create_cron_job", { request });
}

export async function getCronJob(id: string): Promise<CronJob> {
  return invoke("get_cron_job", { id });
}

export async function updateCronJob(id: string, request: UpdateCronJobRequest): Promise<CronJob> {
  return invoke("update_cron_job", { id, request });
}

export async function deleteCronJob(id: string): Promise<void> {
  return invoke("delete_cron_job", { id });
}

export async function toggleCronJob(id: string, enabled: boolean): Promise<CronJob> {
  return invoke("toggle_cron_job", { id, enabled });
}

// ── Cron Runs ──

export async function listCronRuns(jobId: string, limit?: number): Promise<CronRun[]> {
  return invoke("list_cron_runs", { jobId, limit: limit ?? null });
}
