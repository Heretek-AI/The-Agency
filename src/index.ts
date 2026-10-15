import {
  UX_INTERACTION_WALKER_SCRIPT,
  assertTaskInvariants,
  astRewriteWorkspace,
  auditDiffCoverageAndTautology,
  buildCompactionPins,
  captureWorkspaceMtimeSnapshot,
  checkStaleFileRead,
  diffWorkspaceSnapshots,
  extractFaultContext,
  graduateLessonsToSkill,
  inspectInstalledPackage,
  moveModuleAndRewriteImports,
  recordFileReadTimestamp,
  registerFaultLocalizerHook,
  registerNextGenV110Hooks,
  registerNextGenV110Tools,
  speculativeIntegrateWorktrees,
} from "./omni/nextgen-v110.js"
import {
  cacheEpistemicSource,
  classifySpdxLicense,
  generateGrillQuestions,
  listEpistemicSources,
  registerEpistemicTools,
  verifyEpistemicClaims,
} from "./epistemic/dialectic.js"
import {
  discoverClaudeCodeAssets,
  registerClaudeCodeBridge,
  registerClaudeCompatTools,
} from "./compat/claude-code.js"
import {
  UX_SCORECARD_BROWSER_SCRIPT,
  registerUXJudgeTools,
  saveUXScorecard,
  scoreUXMetrics,
} from "./omni/ux-judge.js"
import {
  DOMAIN_PACK_ROLES,
  detectDomainPacks,
  inspectBinaryTarget,
  inspectGDevelopProject,
  inspectGodotScene,
  registerDomainPacks,
} from "./packs/index.js"
import {
  generateSwarmDashboardHtml,
  registerDashboardTools,
} from "./webui/dashboard.js"

import { registerSwarmOSAgents, SWARMOS_ROLES } from "./agents/roles.js"
import {
  evaluateBoardGuard,
  evaluatePermissionGuard,
  matchesPathPattern,
  normalizeResourcePath,
  registerPermissionGuard,
  evaluateFileMutation,
  isTestPath,
  type GuardEvaluator,
  type GuardDecision,
  type PermissionEvaluationEvent,
} from "./agents/guard.js"
import {
  PROMPT_ARCHITECT,
  PROMPT_DIRECTOR,
  PROMPT_MANAGER,
  PROMPT_OFFICE_ANALYST,
  PROMPT_QA_ADVERSARY,
  PROMPT_RELEASE_OPS,
  PROMPT_RESEARCHER,
  PROMPT_STAFF_BACKEND,
  PROMPT_STAFF_UI,
  PROMPT_STUDIO_GUI,
} from "./agents/prompts.js"
import {
  BOARD_VERSION,
  claimTask,
  createEmptyBoard,
  evaluateTaskBudgetViolation,
  createTask,
  getBoardPath,
  initProject,
  loadBoard,
  lockContract,
  planTournament,
  resolveTournament,
  saveBoard,
  setTaskBudget,
  submitQAReceipt,
  taskWorkdir,
  updateTaskStatus,
  verifyReleaseReady,
  withBoardLock,
} from "./board/board.js"
import type {
  AestheticArchetype,
  BoardPolicy,
  ClaimTaskInput,
  Contract,
  CreateTaskInput,
  InitProjectInput,
  LockContractInput,
  OrgBoard,
  PlanTournamentInput,
  ProjectCharter,
  QAReceipt,
  ReleaseReadinessReport,
  ResolveTournamentInput,
  SetTaskBudgetInput,
  SubmitQAReceiptInput,
  Task,
  TaskBudget,
  TaskStatus,
  TaskUsage,
  Tournament,
  TournamentCandidate,
} from "./board/types.js"
import { extractOutline, registerFSTools } from "./codemode/fs-outline.js"
import { registerOrgTools } from "./codemode/org-tools.js"
import { registerUITools } from "./codemode/ui-tools.js"
import { registerOmniCommands } from "./commands/omni.js"
import { registerShipCommand } from "./commands/ship.js"
import { registerSwarmCommand } from "./commands/swarm.js"
import { buildDoctorText, registerDoctorCommand, registerDoctorTools } from "./commands/doctor.js"
import { DEFAULT_CONFIG, getConfigPath, loadConfig, type SwarmOSConfig, type SwarmOSMode } from "./host/config.js"
import { HOST_CONTRACT, hasCapability, missingRequired, probeHost, type HostCapability, type HostProbeResult } from "./host/contract.js"
import {
  formatDoctorReport,
  getSetupReport,
  instrumentHost,
  runSetupModules,
  storeSetupReport,
  type ModuleReport,
  type SetupModule,
  type SetupReport,
} from "./host/setup-report.js"
import { getSessionState, listSessionStates, resetSessionStates, type SessionState } from "./host/session-state.js"
import {
  appendTelemetry,
  getTelemetryDir,
  listTelemetryFiles,
  readTelemetryFile,
  registerTelemetryHooks,
  summarizeTelemetry,
  type TelemetryRecord,
  type TelemetrySummary,
} from "./host/telemetry.js"
import { SWARMOS_VERSION } from "./version.js"
import {
  ROLE_NAMESPACES,
  buildContextBlocks,
  estimateTokens,
  getContextBudgetReport,
  packBlocks,
  registerContextBudgetHook,
  scoreLesson,
  withPinningProfile,
  type ContextBlock,
  type ContextBudgetReport,
} from "./omni/context-budget.js"
import { buildRepoGraph, parseSourceFacts, stripCommentsAndStrings, type ImportEdge, type RepoGraph, type RepoLanguage } from "./omni/repomap.js"
import { analyzeShell, isReadOnly, parseShell, type CommandAnalysis, type ShellAnalysis, type ShellEffect } from "./agents/shell-parse.js"
import {
  beginTransaction,
  finishTransaction,
  mutationTargets,
  registerTransactionHooks,
  resetTransactions,
  transactionStats,
} from "./omni/transactions.js"
import { clearTaint, createTaintEvaluator, recordTaint, registerTaintHooks, registerUntaintCommand } from "./omni/taint.js"
import {
  cleanupTournamentWorktrees,
  commitWorktree,
  isGitRepo,
  mergeTournamentWinner,
  provisionWorktree,
  scoreTournament,
  type CandidateScore,
  type MergeResult,
} from "./board/worktrees.js"
import {
  computeTreeFingerprint,
  discoverChecks,
  extractFailures,
  formatVerifyRun,
  getVerifyDir,
  isTestFile,
  listChangedFiles,
  loadLatestVerifyRun,
  loadVerifyRun,
  parseCounts,
  registerVerifyTools,
  runVerify,
  stripAnsi,
  type VerifyCheck,
  type VerifyCheckResult,
  type VerifyFailure,
  type VerifyKind,
  type VerifyRun,
  type VerifyRunInput,
} from "./omni/verify.js"
import { extractMutatedPaths, registerDiagnosticHook, runQuickDiagnostics } from "./diagnostics/runner.js"
import {
  clearDiagnosticCache,
  findSymbolDefinitions,
  findSymbolReferences,
  getCachedDiagnostic,
  getWarmLspStatus,
  registerLspTools,
  runParallelDiagnostics,
  shutdownWarmLspServers,
  warmDiagnosticStats,
  type CachedDiagEntry,
  type LspSymbolLocation,
} from "./diagnostics/warm-lsp.js"
import {
  createTaskBudgetEvaluator,
  recordTaskSpend,
  registerTaskBudgetHooks,
  resolveSessionTask,
} from "./omni/budget.js"
import {
  exportSessionToBenchmark,
  listReplayableSessions,
  loadSessionTelemetry,
  registerReplayCommand,
  registerReplayTools,
  replaySessionTrace,
  type ExportBenchmarkInput,
  type ExportedBenchmarkTask,
  type ReplayableSession,
  type ReplayExecutionReport,
  type ReplayStepOutcome,
} from "./omni/replay.js"
import { DOM_GEOMETRY_AUDIT_SCRIPT, type DOMAuditResult, type DOMDefect } from "./geometry/audit-script.js"
import { STANDARD_VIEWPORTS, type ViewportDefinition } from "./geometry/viewports.js"
import { MUSE_SOTA_BASE_PROMPT, registerMuseOverlay } from "./muse/overlay.js"
import {
  getArtifactsDir,
  listArtifacts,
  readArtifact,
  registerArtifactContextHook,
  registerArtifactTools,
  writeArtifact,
  type ArtifactName,
} from "./omni/artifacts.js"
import {
  createCheckpoint,
  getCheckpointsDir,
  listCheckpoints,
  registerCheckpointTools,
  rollbackCheckpoint,
  type CheckpointFileEntry,
  type CheckpointManifest,
} from "./omni/checkpoints.js"
import {
  recordAndEvaluateCircuitBreaker,
  registerCircuitBreakerHook,
  resetCircuitBreaker,
  type ToolAttemptRecord,
} from "./omni/circuit-breaker.js"
import {
  captureDesktopWindow,
  registerGuiStudioTools,
  VISUAL_QUALITY_CHECKLIST,
} from "./omni/gui-studio.js"
import {
  computeLineHash,
  hashEditFile,
  hashReadFile,
  registerHashlineTools,
  type HashEditResult,
  type HashLineHunk,
  type HashReadResult,
} from "./omni/hashline.js"
import {
  acceptProposal,
  evaluateNeedsReview,
  forgetLesson,
  getMemoryFilePath,
  getProposalsFilePath,
  lessonMatchesFile,
  loadLessons,
  loadProposals,
  proposeLesson,
  recordLesson,
  recordLessonOutcome,
  registerMemoryContextHook,
  registerMemoryTools,
  registerMemoryUpkeepHooks,
  rejectProposal,
  saveLessons,
  type EpisodicLesson,
  type LessonProposal,
  type LessonStats,
} from "./omni/memory.js"
import {
  extractOfficeOrDataFile,
  registerOfficeTools,
  renderDocumentPreviews,
  SUPPORTED_OFFICE_EXTENSIONS,
} from "./omni/office.js"
import {
  readDevServerLogs,
  registerPtyTapTools,
  type PtyLogReadInput,
} from "./omni/pty-tap.js"
import {
  analyzeBlastRadius,
  buildRepoMap,
  registerRepoMapTools,
  type BlastRadiusReport,
  type RepoMapNode,
  type RepoMapReport,
} from "./omni/repomap.js"
import {
  auditMarkdownCitations,
  getResearchLedgerPath,
  loadResearchSources,
  recordResearchSource,
  registerResearchTools,
  type CitationAuditReport,
  type ResearchSource,
} from "./omni/research.js"
import {
  EMBEDDED_UI_CRAFT_SKILL_MD,
  loadSkillContent,
  registerUICraftSkill,
  UI_CRAFT_SKILL_ID,
  UI_CRAFT_SKILL_NAME,
} from "./skills/ui-craft/skill.js"

export {
  UX_INTERACTION_WALKER_SCRIPT,
  assertTaskInvariants,
  astRewriteWorkspace,
  auditDiffCoverageAndTautology,
  buildCompactionPins,
  captureWorkspaceMtimeSnapshot,
  checkStaleFileRead,
  diffWorkspaceSnapshots,
  extractFaultContext,
  graduateLessonsToSkill,
  inspectInstalledPackage,
  moveModuleAndRewriteImports,
  recordFileReadTimestamp,
  registerFaultLocalizerHook,
  registerNextGenV110Hooks,
  registerNextGenV110Tools,
  speculativeIntegrateWorktrees,
  cacheEpistemicSource,
  classifySpdxLicense,
  generateGrillQuestions,
  listEpistemicSources,
  registerEpistemicTools,
  verifyEpistemicClaims,
  discoverClaudeCodeAssets,
  registerClaudeCodeBridge,
  registerClaudeCompatTools,
  UX_SCORECARD_BROWSER_SCRIPT,
  registerUXJudgeTools,
  saveUXScorecard,
  scoreUXMetrics,
  DOMAIN_PACK_ROLES,
  detectDomainPacks,
  inspectBinaryTarget,
  inspectGDevelopProject,
  inspectGodotScene,
  registerDomainPacks,
  generateSwarmDashboardHtml,
  registerDashboardTools,
  // Agent roles, prompts & runtime guard
  SWARMOS_ROLES,
  PROMPT_DIRECTOR,
  PROMPT_ARCHITECT,
  PROMPT_MANAGER,
  PROMPT_STAFF_BACKEND,
  PROMPT_STAFF_UI,
  PROMPT_QA_ADVERSARY,
  PROMPT_RELEASE_OPS,
  PROMPT_STUDIO_GUI,
  PROMPT_RESEARCHER,
  PROMPT_OFFICE_ANALYST,
  normalizeResourcePath,
  matchesPathPattern,
  evaluateBoardGuard,
  evaluatePermissionGuard,
  registerPermissionGuard,

  // Board operations, tournaments & release readiness gate
  BOARD_VERSION,
  claimTask,
  createEmptyBoard,
  evaluateTaskBudgetViolation,
  loadBoard,
  saveBoard,
  withBoardLock,
  initProject,
  lockContract,
  createTask,
  updateTaskStatus,
  submitQAReceipt,
  planTournament,
  resolveTournament,
  verifyReleaseReady,
  getBoardPath,

  // Omni-Harness: Hashline (Oh-My-Pi precision editing)
  computeLineHash,
  hashReadFile,
  hashEditFile,
  registerHashlineTools,

  // Omni-Harness: Persistent Artifacts (Antigravity state sync)
  getArtifactsDir,
  writeArtifact,
  readArtifact,
  listArtifacts,
  registerArtifactTools,
  registerArtifactContextHook,

  // Omni-Harness: Universal Office & Document Suite (Claude Cowork equivalence)
  SUPPORTED_OFFICE_EXTENSIONS,
  extractOfficeOrDataFile,
  renderDocumentPreviews,
  registerOfficeTools,

  // Omni-Harness: Deep Research & Citation Verification
  getResearchLedgerPath,
  loadResearchSources,
  recordResearchSource,
  auditMarkdownCitations,
  registerResearchTools,

  // Omni-Harness: Web & Desktop GUI Studio
  VISUAL_QUALITY_CHECKLIST,
  captureDesktopWindow,
  registerGuiStudioTools,
  DOM_GEOMETRY_AUDIT_SCRIPT,
  STANDARD_VIEWPORTS,
  extractOutline,

  // v0.5.0: PageRank RepoMap & Reverse-Import Blast-Radius Analyzer
  buildRepoMap,
  analyzeBlastRadius,
  registerRepoMapTools,

  // v0.5.0: Doom-Loop Circuit Breaker
  resetCircuitBreaker,
  recordAndEvaluateCircuitBreaker,
  registerCircuitBreakerHook,

  // v0.5.0: Zero-Git-Noise Time-Travel Checkpoints
  getCheckpointsDir,
  createCheckpoint,
  rollbackCheckpoint,
  listCheckpoints,
  registerCheckpointTools,

  // v0.5.0: Cross-Session Episodic Memory
  getMemoryFilePath,
  loadLessons,
  recordLesson,
  registerMemoryTools,
  registerMemoryContextHook,

  // v0.5.0: Live Persistent Terminal & Dev-Server Log Tap
  readDevServerLogs,
  registerPtyTapTools,

  // Diagnostics & Muse overlay
  runQuickDiagnostics,
  extractMutatedPaths,
  MUSE_SOTA_BASE_PROMPT,
  registerMuseOverlay,

  // Skills & Commands
  UI_CRAFT_SKILL_ID,
  UI_CRAFT_SKILL_NAME,
  EMBEDDED_UI_CRAFT_SKILL_MD,
  loadSkillContent,
  registerOmniCommands,

  // v0.6.0: Host contract, /doctor, config & telemetry
  SWARMOS_VERSION,
  HOST_CONTRACT,
  hasCapability,
  probeHost,
  missingRequired,
  instrumentHost,
  runSetupModules,
  storeSetupReport,
  getSetupReport,
  formatDoctorReport,
  buildDoctorText,
  registerDoctorTools,
  registerDoctorCommand,
  DEFAULT_CONFIG,
  getConfigPath,
  loadConfig,
  getSessionState,
  listSessionStates,
  resetSessionStates,
  appendTelemetry,
  getTelemetryDir,
  listTelemetryFiles,
  readTelemetryFile,
  registerTelemetryHooks,
  summarizeTelemetry,

  // v0.6.0: tools.verify
  discoverChecks,
  runVerify,
  loadVerifyRun,
  loadLatestVerifyRun,
  formatVerifyRun,
  computeTreeFingerprint,
  listChangedFiles,
  extractFailures,
  parseCounts,
  stripAnsi,
  isTestFile,
  getVerifyDir,
  registerVerifyTools,
  taskWorkdir,

  // v0.7.0: shell parser, file guard, worktree tournaments, transactions & taint tracking
  parseShell,
  analyzeShell,
  isReadOnly,
  evaluateFileMutation,
  isTestPath,
  provisionWorktree,
  commitWorktree,
  isGitRepo,
  scoreTournament,
  mergeTournamentWinner,
  cleanupTournamentWorktrees,
  mutationTargets,
  beginTransaction,
  finishTransaction,
  registerTransactionHooks,
  resetTransactions,
  transactionStats,
  recordTaint,
  clearTaint,
  createTaintEvaluator,
  registerTaintHooks,
  registerUntaintCommand,

  // v0.8.0: context budget, memory upkeep, multi-language RepoMap & pinning profile
  ROLE_NAMESPACES,
  buildContextBlocks,
  estimateTokens,
  getContextBudgetReport,
  packBlocks,
  registerContextBudgetHook,
  scoreLesson,
  withPinningProfile,
  buildRepoGraph,
  parseSourceFacts,
  stripCommentsAndStrings,
  acceptProposal,
  evaluateNeedsReview,
  forgetLesson,
  getProposalsFilePath,
  lessonMatchesFile,
  loadProposals,
  proposeLesson,
  recordLessonOutcome,
  registerMemoryUpkeepHooks,
  rejectProposal,
  saveLessons,

  // v0.9.0: Task spend/step budgets, Session Replay -> Benchmarks, Warm Parallel LSP Diagnostics
  setTaskBudget,
  resolveSessionTask,
  recordTaskSpend,
  createTaskBudgetEvaluator,
  registerTaskBudgetHooks,
  listReplayableSessions,
  loadSessionTelemetry,
  exportSessionToBenchmark,
  replaySessionTrace,
  registerReplayTools,
  registerReplayCommand,
  runParallelDiagnostics,
  getCachedDiagnostic,
  clearDiagnosticCache,
  warmDiagnosticStats,
  findSymbolDefinitions,
  findSymbolReferences,
  getWarmLspStatus,
  shutdownWarmLspServers,
  registerLspTools,
}

export type {
  SwarmOSConfig,
  SwarmOSMode,
  HostCapability,
  HostProbeResult,
  ModuleReport,
  SetupModule,
  SetupReport,
  SessionState,
  TelemetryRecord,
  TelemetrySummary,
  VerifyCheck,
  VerifyCheckResult,
  VerifyFailure,
  VerifyKind,
  VerifyRun,
  VerifyRunInput,
  ContextBlock,
  ContextBudgetReport,
  ImportEdge,
  RepoGraph,
  RepoLanguage,
  LessonProposal,
  LessonStats,
  BoardPolicy,
  CommandAnalysis,
  ShellAnalysis,
  ShellEffect,
  CandidateScore,
  MergeResult,
  GuardEvaluator,
  AestheticArchetype,
  OrgBoard,
  ProjectCharter,
  Contract,
  Task,
  TaskStatus,
  QAReceipt,
  Tournament,
  TournamentCandidate,
  ReleaseReadinessReport,
  InitProjectInput,
  LockContractInput,
  CreateTaskInput,
  SubmitQAReceiptInput,
  PlanTournamentInput,
  ResolveTournamentInput,
  GuardDecision,
  PermissionEvaluationEvent,
  DOMDefect,
  DOMAuditResult,
  ViewportDefinition,
  HashLineHunk,
  HashReadResult,
  HashEditResult,
  ArtifactName,
  ResearchSource,
  CitationAuditReport,
  RepoMapNode,
  RepoMapReport,
  BlastRadiusReport,
  ToolAttemptRecord,
  CheckpointFileEntry,
  CheckpointManifest,
  EpisodicLesson,
  PtyLogReadInput,
  TaskBudget,
  TaskUsage,
  ClaimTaskInput,
  SetTaskBudgetInput,
  ReplayableSession,
  ExportBenchmarkInput,
  ExportedBenchmarkTask,
  ReplayStepOutcome,
  ReplayExecutionReport,
  CachedDiagEntry,
  LspSymbolLocation,
}

export const SWARMOS_PLUGIN_ID = "heretek.swarmos"

/**
 * Builds the ordered list of SwarmOS setup modules. Each module declares the host
 * capabilities it needs so `/doctor` can explain exactly why it is or is not active.
 */
export function buildSetupModules(rootDir: string, config: SwarmOSConfig): SetupModule[] {
  const observe: SetupModule[] = [
    {
      id: "telemetry",
      requires: ["tool.hook"],
      run: (c) => registerTelemetryHooks(c, rootDir, config.telemetry),
    },
    {
      id: "doctor",
      requires: ["tool.transform", "command.transform"],
      run: async (c) => {
        await c.tool.transform((editor: any) => registerDoctorTools(editor, rootDir))
        await registerDoctorCommand(c, rootDir)
      },
    },
  ]
  if (config.mode === "observe") return observe

  return [
    { id: "agents", requires: ["agent.transform"], run: (c) => c.agent.transform((editor: any) => registerSwarmOSAgents(editor)) },
    {
      id: "codemode-tools",
      requires: ["tool.transform"],
      run: (c) =>
        c.tool.transform((rawEditor: any) => {
          const editor = withPinningProfile(rawEditor, config.pinnedNamespaces)
          registerOrgTools(editor, rootDir)
          registerUITools(editor)
      registerUXJudgeTools(editor, rootDir)
      registerEpistemicTools(editor, rootDir)
      registerClaudeCompatTools(editor, rootDir)
      registerDashboardTools(editor, rootDir)
      registerNextGenV110Tools(editor, rootDir)
          registerFSTools(editor, rootDir)
          registerHashlineTools(editor, rootDir)
          registerArtifactTools(editor, rootDir)
          registerOfficeTools(editor, rootDir)
          registerResearchTools(editor, rootDir)
          registerGuiStudioTools(editor, rootDir)
          registerRepoMapTools(editor, rootDir)
          registerCheckpointTools(editor, rootDir)
          registerMemoryTools(editor, rootDir)
          registerPtyTapTools(editor, c, rootDir)
          registerVerifyTools(editor, rootDir)
          registerReplayTools(editor, rootDir)
          registerLspTools(editor, rootDir, (r, p) => runQuickDiagnostics(r, p))
        }),
    },
    {
      id: "permission-guard",
      requires: ["permission.hook"],
      run: (c) => registerPermissionGuard(c, rootDir, [
        ...(config.taintTracking ? [createTaintEvaluator(rootDir)] : []),
        createTaskBudgetEvaluator(),
      ]),
    },
    ...(config.autoTransactions
      ? [{ id: "transactions", requires: ["tool.hook"], run: (c: any) => registerTransactionHooks(c, rootDir) }]
      : []),
    ...(config.taintTracking
      ? [
          {
            id: "taint-tracking",
            requires: ["tool.hook"],
            run: async (c: any) => {
              await registerTaintHooks(c)
              await registerUntaintCommand(c)
            },
          },
        ]
      : []),
    { id: "diagnostics", requires: ["tool.hook"], run: (c) => registerDiagnosticHook(c, rootDir) },
    { id: "nextgen-self-healing", requires: ["tool.hook"], run: (c) => registerNextGenV110Hooks(c, rootDir) },
    { id: "task-budgets", requires: ["tool.hook"], run: (c) => registerTaskBudgetHooks(c, rootDir) },
    { id: "circuit-breaker", requires: ["tool.hook"], run: (c) => registerCircuitBreakerHook(c) },
    // Runs after the circuit breaker so it sees interventions and can draft lesson proposals.
    { id: "memory-upkeep", requires: ["tool.hook"], run: (c) => registerMemoryUpkeepHooks(c, rootDir) },
    { id: "ui-craft-skill", requires: ["skill.transform"], run: (c) => registerUICraftSkill(c, rootDir) },
    { id: "muse-overlay", requires: ["session.hook"], run: (c) => registerMuseOverlay(c) },
    {
      id: "context-budget",
      requires: ["session.hook"],
      run: (c) => registerContextBudgetHook(c, rootDir, config.contextBudgetTokens),
    },
    {
      id: "commands",
      requires: ["command.transform"],
      run: async (c) => {
        await registerShipCommand(c)
        await registerSwarmCommand(c, rootDir)
        await registerOmniCommands(c, rootDir)
        await registerReplayCommand(c, rootDir)
      },
    },
    {
      id: "claude-compat-bridge",
      requires: ["command.transform"],
      run: (c) => registerClaudeCodeBridge(c, rootDir),
    },
    {
      id: "domain-packs",
      requires: ["tool.transform"],
      run: (c) => registerDomainPacks(c, rootDir),
    },
    // Telemetry runs last so its execute.after hook sees interventions appended by earlier hooks.
    ...observe,
  ]
}

/**
 * OpenCode SwarmOS Omni-Harness Plugin Setup Function.
 */
export async function setup(ctx: any): Promise<SetupReport> {
  const rootDir = ctx.location?.directory ?? process.cwd()
  const config = await loadConfig(rootDir)
  const report: SetupReport = {
    version: SWARMOS_VERSION,
    mode: config.mode,
    rootDir,
    startedAt: new Date().toISOString(),
    host: probeHost(ctx),
    modules: [],
  }
  storeSetupReport(report)
  await runSetupModules(ctx, buildSetupModules(rootDir, config), report)
  return report
}

export interface SwarmOSPluginCallable {
  (ctx: any): Promise<void>
  readonly id: string
  readonly setup: (ctx: any) => Promise<SetupReport>
}

export const SwarmOSPlugin: SwarmOSPluginCallable = Object.assign(
  async function SwarmOSPlugin(ctx: any): Promise<void> {
    await setup(ctx)
  },
  {
    id: SWARMOS_PLUGIN_ID,
    setup,
  },
)

export default SwarmOSPlugin
export const plugin = SwarmOSPlugin
