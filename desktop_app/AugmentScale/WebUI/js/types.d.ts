/**
 * TypeScript Type Definitions for Augment Scale Bridge Boundary.
 *
 * These types mirror the C# DTOs and command payloads defined in AugmentScale.Models.
 * Used by IDE language servers (VS Code, Visual Studio) with JSDoc / @ts-check
 * to validate IPC payloads and frontend state without requiring a JS bundler.
 */

export interface ProfileDto {
  id: string;
  code: string;
  name: string;
  firstName: string;
  role: string;
  shift: string;
  avatar: string;
  color: string;
  pinSet: boolean;
  token?: string;
}

export interface VehicleDto {
  plate: string;
  driver: string;
  phone: string;
  material: string;
  client: string;
  status: 'active' | 'archived' | string;
  tripCount: number;
  lastTare: number | null;
  lastWeighed: string | null;
  archivedAt: string | null;
  archivedBy: string | null;
  archivedReason: string | null;
  registeredBy?: string | null;
  registeredAt?: string | null;
  notes?: string | null;
}

export interface PrintLogEntryDto {
  by: string;
  at: string;
  type: string;
  reason?: string | null;
  copyNumber?: number | null;
}

export interface TicketOverrideDto {
  reason: string;
  operator: string;
  timestamp: string;
  anomalyDetails?: any;
}

export interface TicketDto {
  id: number;
  ticketDisplayId: string;
  truckNo: string;
  driver: string;
  phone: string;
  material: string;
  client: string;
  challan: string;
  remarks: string;
  direction: 'IN' | 'OUT' | string;
  weightType: string;
  status: 'pending' | 'completed' | 'voided' | 'deleted' | string;
  deleted: boolean;
  businessAt?: string | null;

  firstWeight: number | null;
  firstWeightType: string | null;
  firstWeightTime: string | null;
  firstOperator: string | null;
  firstOperatorAvatar: string | null;

  secondWeight: number | null;
  secondWeightType: string | null;
  secondWeightTime: string | null;
  secondOperator: string | null;
  secondOperatorAvatar: string | null;

  grossWeight: number | null;
  tareWeight: number | null;
  netWeight: number | null;

  lastTare: number | null;
  lastGross: number | null;
  lastPayload: number | null;
  lastWeighAt: string | null;

  timeElapsed: string | null;
  createdAt: string | null;
  completedAt: string | null;
  secondCompletedAt?: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  voidedReason: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
  deletedReason: string | null;

  printCount: number;
  printLog: PrintLogEntryDto[];
  override: TicketOverrideDto | null;
  source?: string | null;
  _source?: string;
}

export interface ArchiveRunDto {
  id: string;
  startedAt: string;
  completedAt?: string | null;
  kind: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  ticketsArchived: number;
  outputFilePath?: string | null;
  errorMessage?: string | null;
}

export interface ArchiveStatusDto {
  state: string;
  pendingCount: number;
  processingCount: number;
  failedCount: number;
  succeededCount: number;
  skippedCount: number;
  lastSuccessAt?: string | null;
  lastSuccessKind?: string | null;
  lastSuccessPeriodEnd?: string | null;
  lastSuccessFilePath?: string | null;
  lastError?: string | null;
  lastErrorAt?: string | null;
  recentRuns: ArchiveRunDto[];
}

export interface SyncStatusDto {
  isHealthy: boolean;
  pendingQueue: number;
  lastSyncTimestamp: string;
  outboxTotal: number;
  archive: ArchiveStatusDto;
}

export interface BootStateDto {
  operators: ProfileDto[];
  vehicles: VehicleDto[];
  pending: TicketDto[];
  history: TicketDto[];
  nextTicketNumber: number;
  sync: SyncStatusDto;
}

export interface HistoryFilterOptionsDto {
  drivers: string[];
  operators: string[];
  materials: string[];
  clients: string[];
}

export interface HistoryPageDto {
  tickets: TicketDto[];
  total: number;
  page: number;
  pageSize: number;
  netKg: number;
  options?: HistoryFilterOptionsDto | null;
}

export interface LiveWeightData {
  weight: number;
  isStable: boolean;
  variance?: number;
  isConnected: boolean;
  source: string;
  capturedAt: string;
}

export interface ScaleStatusData {
  isConnected: boolean;
  isSimulator: boolean;
  portName: string;
  message: string;
  hasReading?: boolean;
}

// Command Request Payloads
export interface PinAuthRequest {
  operatorId: string;
  pin: string;
}

export interface ProfileAdminAuthRequest {
  operatorId: string;
  pin: string;
}

export interface ProfileWriteRequest {
  token: string;
  id?: string;
  displayName?: string;
  firstName?: string;
  code?: string;
  role?: string;
  shift?: string;
  avatar?: string;
  color?: string;
  pin?: string;
}

export interface SetProfilePinRequest {
  token: string;
  profileId: string;
  pin: string;
}

export interface DeactivateProfileRequest {
  token: string;
  profileId: string;
  reason: string;
}

export interface VehicleQueryRequest {
  includeArchived?: boolean;
}

export interface HistoryQueryRequest {
  limit?: number;
  offset?: number;
  status?: string;
}

export interface HistoryPageRequest {
  fromDate: string;
  toDate: string;
  search?: string;
  statuses?: string[];
  drivers?: string[];
  operators?: string[];
  materials?: string[];
  clients?: string[];
  directions?: string[];
  flags?: string[];
  sortKey?: string;
  sortDir?: string;
  page: number;
  pageSize?: number;
  includeOptions?: boolean;
}

export interface TicketIdRequest {
  ticketId: number;
}

export interface HistoryReportRequest {
  fromDate: string;
  toDate: string;
  operatorId: string;
  pin: string;
}

export interface VerifyHistoryReportRequest {
  reportId: string;
  integrityHash: string;
}

export interface CreateTicketRequest {
  ticketId?: number;
  truckNo: string;
  direction?: string;
  driver?: string;
  phone?: string;
  material?: string;
  client?: string;
  challan?: string;
  remarks?: string;
  weightKg: number;
  firstWeightType?: string;
  firstTime?: string;
  operatorId?: string;
  operatorName?: string;
  recordFirstPrint?: boolean;
}

export interface CompleteTicketRequest {
  ticketId: number;
  weightKg: number;
  secondTime?: string;
  operatorId?: string;
  operatorName?: string;
  override?: {
    reason: string;
    operator: string;
    timestamp: string;
    anomalyDetails?: any;
  };
  recordCertificatePrint?: boolean;
}

export interface TicketReasonRequest {
  ticketId: number;
  reason: string;
  operatorId?: string;
  operatorName?: string;
}

export interface ReprintRequest {
  ticketId: number;
  reason: string;
  operatorId?: string;
  operatorName?: string;
  documentType?: string;
}

export interface VehicleRequest {
  plate: string;
  driver?: string;
  phone?: string;
  material?: string;
  client?: string;
  operatorId?: string;
  operatorName?: string;
}

export interface ArchiveVehicleRequest {
  plate: string;
  reason: string;
  operatorId?: string;
  operatorName?: string;
}

export interface DeleteVehicleRequest {
  plate: string;
  reason: string;
  operatorId?: string;
  operatorName?: string;
}

// Master Bridge Commands Map
export interface BridgeCommands {
  getBootState: { request?: void | Record<string, never>; response: BootStateDto };
  getOperators: { request?: void | Record<string, never>; response: ProfileDto[] };
  authenticatePin: { request: PinAuthRequest; response: ProfileDto | null };
  unlockProfileAdmin: {
    request: ProfileAdminAuthRequest;
    response: { token: string; expiresAt: string; actor: ProfileDto };
  };
  createProfile: { request: ProfileWriteRequest; response: ProfileDto };
  updateProfile: { request: ProfileWriteRequest; response: ProfileDto };
  setProfilePin: { request: SetProfilePinRequest; response: boolean };
  deactivateProfile: { request: DeactivateProfileRequest; response: boolean };
  getVehicles: { request?: VehicleQueryRequest | Record<string, never>; response: VehicleDto[] };
  getPendingTickets: { request?: void | Record<string, never>; response: TicketDto[] };
  getHistory: { request: HistoryQueryRequest; response: TicketDto[] };
  queryHistory: { request: HistoryPageRequest; response: HistoryPageDto };
  getTicket: { request: TicketIdRequest; response: TicketDto | null };
  generateHistoryReport: { request: HistoryReportRequest; response: any };
  verifyHistoryReport: { request: VerifyHistoryReportRequest; response: any };
  showSystemPrintDialog: { request?: void | Record<string, never>; response: boolean };
  getNextTicketNumber: { request?: void | Record<string, never>; response: number };
  getSyncStatus: { request?: void | Record<string, never>; response: SyncStatusDto };
  retryArchive: { request?: void | Record<string, never>; response: { retried: number } };
  getScaleStatus: { request?: void | Record<string, never>; response: ScaleStatusData };
  captureReading: { request?: void | Record<string, never>; response: { captured: boolean } };
  createTicket: { request: CreateTicketRequest; response: TicketDto };
  completeTicket: { request: CompleteTicketRequest; response: TicketDto };
  voidTicket: { request: TicketReasonRequest; response: TicketDto };
  deleteTicket: { request: TicketReasonRequest; response: TicketDto };
  registerVehicle: { request: VehicleRequest; response: VehicleDto };
  archiveVehicle: { request: ArchiveVehicleRequest; response: VehicleDto };
  restoreVehicle: { request: ArchiveVehicleRequest; response: VehicleDto };
  deleteVehicle: { request: DeleteVehicleRequest; response: boolean };
  recordReprint: { request: ReprintRequest; response: { ticket: TicketDto; copyNumber: number } };
}
