export interface WeighTicket {
  id: string;
  organization_id: string;
  site_id: string;
  weighbridge_id: string;
  workstation_id: string;
  ticket_number: number;
  ticket_display_id: string;
  direction: 'IN' | 'OUT';
  status: 'pending' | 'completed' | 'voided';
  vehicle_id?: string | null;
  plate_number: string;
  product_id?: string | null;
  product_name?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  driver_id?: string | null;
  driver_name?: string | null;
  driver_phone?: string | null;
  challan?: string | null;
  remarks?: string | null;
  first_weight_kg?: number | null;
  first_weight_type?: string | null;
  first_weight_at?: string | null;
  first_weight_capture_id?: string | null;
  first_operator_id?: string | null;
  first_operator_name?: string | null;
  second_weight_kg?: number | null;
  second_weight_type?: string | null;
  second_weight_at?: string | null;
  second_weight_capture_id?: string | null;
  second_operator_id?: string | null;
  second_operator_name?: string | null;
  gross_weight_kg?: number | null;
  tare_weight_kg?: number | null;
  net_weight_kg?: number | null;
  is_overridden: boolean;
  override_reason?: string | null;
  override_operator_id?: string | null;
  override_operator_name?: string | null;
  override_anomaly_details?: string | null;
  override_at?: string | null;
  completed_at?: string | null;
  voided_at?: string | null;
  voided_by?: string | null;
  voided_reason?: string | null;
  row_version: number;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  deleted_at?: string | null;
  deleted_by?: string | null;
  deleted_reason?: string | null;
  synced_at: string;
  status_display?: string;
  stage?: string;
  business_at?: string;
  last_status_at?: string;
  print_count?: number;
  first_operator_avatar?: string | null;
  second_operator_avatar?: string | null;
}

export interface Vehicle {
  id: string;
  organization_id: string;
  plate_number: string;
  plate_normalized: string;
  default_driver_name?: string | null;
  default_driver_phone?: string | null;
  default_client?: string | null;
  default_material?: string | null;
  notes?: string | null;
  trip_count: number;
  last_weighed_at?: string | null;
  last_tare_kg?: number | null;
  registered_by?: string | null;
  updated_by?: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface TicketCorrection {
  id: string;
  ticket_id: string;
  organization_id: string;
  correction_type: string;
  field_changed?: string | null;
  old_value?: string | null;
  new_value?: string | null;
  reason: string;
  requested_by: string;
  requested_at: string;
  approved_by?: string | null;
  approved_at?: string | null;
  approval_status?: string | null;
  created_at: string;
  synced_at: string;
}

export interface Profile {
  id: string;
  organization_id: string;
  display_name: string;
  first_name?: string | null;
  initials?: string | null;
  avatar_url?: string | null;
  color?: string | null;
  shift?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserRole {
  id: string;
  profile_id: string;
  organization_id: string;
  site_id?: string | null;
  role: string;
  granted_at: string;
  granted_by?: string | null;
}

export interface Weighbridge {
  id: string;
  site_id: string;
  name: string;
  max_capacity_kg?: number | null;
  min_division_kg?: number | null;
  created_at: string;
  updated_at: string;
}

export interface Workstation {
  id: string;
  organization_id: string;
  site_id: string;
  weighbridge_id: string;
  hostname?: string | null;
  device_key_thumbprint?: string | null;
  registered_at: string;
  last_seen_at?: string | null;
  settings?: string | null;
  created_at: string;
  updated_at: string;
}
