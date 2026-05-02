import { centerSchema, type CenterFormValues } from "@/lib/schemas/center";
import { nextPublicApiBaseUrl } from "@/lib/env";
import {
  providerApiSchema,
  providerSchema,
  providersApiSchema,
  type ProviderApiValues,
  type ProviderFormValues,
} from "@/lib/schemas/provider";
import {
  roomSchema,
  roomTypeSchema,
  type RoomFormValues,
  type RoomTypeFormValues,
} from "@/lib/schemas/room";
import {
  persistedScheduleVersionApiSchema,
  providerSlotEligibilityApiSchema,
  scheduleDraftSaveResponseApiSchema,
  scheduleGenerateResponseApiSchema,
  schedulePeriodApiSchema,
  schedulePeriodFormSchema,
  schedulePublishResponseApiSchema,
  scheduleVersionDetailApiSchema,
  type ScheduleVersionDetailApi,
  type SchedulePeriodApi,
  type SchedulePeriodFormValues,
  type PersistedScheduleVersionApi,
  type ScheduleGenerateResponseApi,
  type SchedulePublishResponseApi,
  type ProviderSlotEligibilityApi,
} from "@/lib/schemas/schedule";
import {
  providerWeeklyAvailabilityReadApiSchema,
  providerWeeklyAvailabilityReplaceApiSchema,
  providerWeeklyAvailabilitySchema,
  type ProviderWeeklyAvailability,
} from "@/lib/schemas/provider-weekly-availability";

export type Center = {
  id: string;
  name: string;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  timezone: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Room = {
  id: string;
  center_id: string;
  name: string;
  display_order: number;
  md_only: boolean;
  is_active: boolean;
  room_types: RoomType[];
  created_at: string;
  updated_at: string;
};

export type RoomType = {
  id: string;
  name: string;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Provider = ProviderApiValues;

export type SchedulePeriod = SchedulePeriodApi;

export type PersistedScheduleVersion = PersistedScheduleVersionApi;

export type ScheduleVersionDetail = ScheduleVersionDetailApi;

export type ScheduleGenerateResponse = ScheduleGenerateResponseApi;

export type SchedulePublishResponse = SchedulePublishResponseApi;
export type ProviderSlotEligibility = ProviderSlotEligibilityApi;
export type ProviderWeeklyAvailabilityRecord = ProviderWeeklyAvailability;

export type ScheduleAssignmentSavePayload = {
  provider_id: string | null;
  center_id: string;
  room_id: string | null;
  shift_requirement_id: string | null;
  required_provider_type: string | null;
  shift_type: "full_shift" | "first_half" | "second_half" | "short_shift";
  start_time: string;
  end_time: string;
  source: string;
  notes: string | null;
};

export type ScheduleDraftSavePayload = {
  schedule_period_id: string;
  parent_schedule_version_id: string | null;
  notes: string | null;
  assignments: ScheduleAssignmentSavePayload[];
};

export type ScheduleGeneratePayload = {
  parent_schedule_version_id: string | null;
  notes: string | null;
  assignments: ScheduleAssignmentSavePayload[];
};

export type ProviderSlotEligibilityPayload = {
  schedule_period_id: string;
  schedule_version_id: string | null;
  assignment_id: string | null;
  provider_id: string;
  center_id: string;
  room_id: string | null;
  required_provider_type: string | null;
  shift_type: "full_shift" | "first_half" | "second_half" | "short_shift";
  start_time: string;
  end_time: string;
};

async function requestJson<TResponse>(
  path: string,
  init?: RequestInit,
): Promise<TResponse> {
  const url = `${nextPublicApiBaseUrl}${path}`;
  const response = await fetch(url, init);

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(responseText);
  }

  const responseJson = (await response.json()) as TResponse;
  return responseJson;
}

function jsonRequestInit(method: string, body: unknown): RequestInit {
  const bodyText = JSON.stringify(body);
  const init = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: bodyText,
    cache: "no-store" as RequestCache,
  };
  return init;
}

function centerPayload(values: CenterFormValues) {
  const payload = {
    name: values.name,
    address_line_1: values.addressLine1 || null,
    address_line_2: values.addressLine2 || null,
    city: values.city || null,
    state: values.state || null,
    postal_code: values.postalCode || null,
    timezone: values.timezone,
  };
  return payload;
}

function roomPayload(values: RoomFormValues) {
  const payload = {
    name: values.name,
    display_order: values.displayOrder,
    md_only: values.mdOnly,
    room_type_ids: values.roomTypeIds,
  };
  return payload;
}

function roomTypePayload(values: RoomTypeFormValues) {
  const payload = {
    name: values.name,
    display_order: values.displayOrder,
  };
  return payload;
}

function providerPayload(values: ProviderFormValues) {
  const email = values.email === "" ? null : values.email;
  const payload = {
    first_name: values.firstName,
    last_name: values.lastName,
    display_name: values.displayName,
    email,
    phone: values.phone || null,
    provider_type: values.providerType,
    employment_type: values.employmentType,
    notes: values.notes || null,
    credentialed_center_ids: values.credentialedCenterIds,
    skill_room_type_ids: values.skillRoomTypeIds,
  };
  return payload;
}

export async function listCenters(): Promise<Center[]> {
  const centers = await requestJson<Center[]>("/centers", { cache: "no-store" });
  return centers;
}

export async function getCenter(centerId: string): Promise<Center> {
  const center = await requestJson<Center>(`/centers/${centerId}`, { cache: "no-store" });
  return center;
}

export async function createCenter(values: CenterFormValues): Promise<Center> {
  const parsedValues = centerSchema.parse(values);
  const payload = centerPayload(parsedValues);
  const init = jsonRequestInit("POST", payload);
  const center = await requestJson<Center>("/centers", init);
  return center;
}

export async function updateCenter(
  centerId: string,
  values: CenterFormValues,
): Promise<Center> {
  const parsedValues = centerSchema.parse(values);
  const payload = centerPayload(parsedValues);
  const init = jsonRequestInit("PATCH", payload);
  const center = await requestJson<Center>(`/centers/${centerId}`, init);
  return center;
}

export async function deactivateCenter(centerId: string): Promise<Center> {
  const center = await requestJson<Center>(`/centers/${centerId}`, {
    method: "DELETE",
    cache: "no-store",
  });
  return center;
}

export async function listRoomsForCenter(centerId: string): Promise<Room[]> {
  const rooms = await requestJson<Room[]>(`/centers/${centerId}/rooms`, { cache: "no-store" });
  return rooms;
}

export async function listRoomTypes(): Promise<RoomType[]> {
  const roomTypes = await requestJson<RoomType[]>("/room-types", { cache: "no-store" });
  return roomTypes;
}

export async function createRoomType(values: RoomTypeFormValues): Promise<RoomType> {
  const parsedValues = roomTypeSchema.parse(values);
  const payload = roomTypePayload(parsedValues);
  const init = jsonRequestInit("POST", payload);
  const roomType = await requestJson<RoomType>("/room-types", init);
  return roomType;
}

export async function updateRoomType(
  roomTypeId: string,
  values: RoomTypeFormValues,
): Promise<RoomType> {
  const parsedValues = roomTypeSchema.parse(values);
  const payload = roomTypePayload(parsedValues);
  const init = jsonRequestInit("PATCH", payload);
  const roomType = await requestJson<RoomType>(`/room-types/${roomTypeId}`, init);
  return roomType;
}

export async function deactivateRoomType(roomTypeId: string): Promise<RoomType> {
  const roomType = await requestJson<RoomType>(`/room-types/${roomTypeId}`, {
    method: "DELETE",
    cache: "no-store",
  });
  return roomType;
}

export async function createRoom(values: RoomFormValues): Promise<Room> {
  const parsedValues = roomSchema.parse(values);
  const payload = roomPayload(parsedValues);
  const init = jsonRequestInit("POST", payload);
  const room = await requestJson<Room>(`/centers/${parsedValues.centerId}/rooms`, init);
  return room;
}

export async function updateRoom(
  roomId: string,
  values: RoomFormValues,
): Promise<Room> {
  const parsedValues = roomSchema.parse(values);
  const payload = roomPayload(parsedValues);
  const init = jsonRequestInit("PATCH", payload);
  const room = await requestJson<Room>(`/rooms/${roomId}`, init);
  return room;
}

export async function deleteRoom(roomId: string): Promise<Room> {
  const room = await requestJson<Room>(`/rooms/${roomId}`, {
    method: "DELETE",
    cache: "no-store",
  });
  return room;
}

export async function listProviders(): Promise<Provider[]> {
  const responseJson = await requestJson<unknown[]>("/providers", { cache: "no-store" });
  const providers = providersApiSchema.parse(responseJson);
  return providers;
}

export async function getProvider(providerId: string): Promise<Provider> {
  const responseJson = await requestJson<unknown>(`/providers/${providerId}`, { cache: "no-store" });
  const provider = providerApiSchema.parse(responseJson);
  return provider;
}

export async function createProvider(values: ProviderFormValues): Promise<Provider> {
  const parsedValues = providerSchema.parse(values);
  const payload = providerPayload(parsedValues);
  const init = jsonRequestInit("POST", payload);
  const responseJson = await requestJson<unknown>("/providers", init);
  const provider = providerApiSchema.parse(responseJson);
  return provider;
}

export async function updateProvider(
  providerId: string,
  values: ProviderFormValues,
): Promise<Provider> {
  const parsedValues = providerSchema.parse(values);
  const payload = providerPayload(parsedValues);
  const init = jsonRequestInit("PATCH", payload);
  const responseJson = await requestJson<unknown>(`/providers/${providerId}`, init);
  const provider = providerApiSchema.parse(responseJson);
  return provider;
}

export async function deactivateProvider(providerId: string): Promise<Provider> {
  const responseJson = await requestJson<unknown>(`/providers/${providerId}`, {
    method: "DELETE",
    cache: "no-store",
  });
  const provider = providerApiSchema.parse(responseJson);
  return provider;
}

export async function listSchedulePeriods(): Promise<SchedulePeriod[]> {
  const responseJson = await requestJson<unknown[]>("/schedule-periods", {
    cache: "no-store",
  });
  const periods = responseJson.map((periodJson) => {
    const period = schedulePeriodApiSchema.parse(periodJson);
    return period;
  });
  return periods;
}

function schedulePeriodPayload(values: SchedulePeriodFormValues) {
  const payload = {
    name: values.name,
    start_date: values.startDate,
    end_date: values.endDate,
    status: "draft",
  };
  return payload;
}

export async function createSchedulePeriod(
  values: SchedulePeriodFormValues,
): Promise<SchedulePeriod> {
  const parsedValues = schedulePeriodFormSchema.parse(values);
  const payload = schedulePeriodPayload(parsedValues);
  const init = jsonRequestInit("POST", payload);
  const responseJson = await requestJson<unknown>("/schedule-periods", init);
  const period = schedulePeriodApiSchema.parse(responseJson);
  return period;
}

export async function getSchedulePeriod(periodId: string): Promise<SchedulePeriod> {
  const responseJson = await requestJson<unknown>(`/schedule-periods/${periodId}`, {
    cache: "no-store",
  });
  const period = schedulePeriodApiSchema.parse(responseJson);
  return period;
}

export async function listScheduleVersions(
  periodId: string,
): Promise<PersistedScheduleVersion[]> {
  const responseJson = await requestJson<unknown[]>(
    `/schedule-periods/${periodId}/versions`,
    { cache: "no-store" },
  );
  const versions = responseJson.map((versionJson) => {
    const version = persistedScheduleVersionApiSchema.parse(versionJson);
    return version;
  });
  return versions;
}

export async function getScheduleVersion(
  versionId: string,
): Promise<ScheduleVersionDetail> {
  const responseJson = await requestJson<unknown>(`/schedule-versions/${versionId}`, {
    cache: "no-store",
  });
  const detail = scheduleVersionDetailApiSchema.parse(responseJson);
  return detail;
}

export async function saveDraftScheduleVersion(
  payload: ScheduleDraftSavePayload,
): Promise<ScheduleVersionDetail> {
  const init = jsonRequestInit("POST", payload);
  const responseJson = await requestJson<unknown>("/schedule-versions/draft", init);
  const detail = scheduleDraftSaveResponseApiSchema.parse(responseJson);
  return detail;
}

export async function generateScheduleVersion(
  periodId: string,
  payload: ScheduleGeneratePayload,
): Promise<ScheduleGenerateResponse> {
  const init = jsonRequestInit("POST", payload);
  const responseJson = await requestJson<unknown>(
    `/schedule-periods/${periodId}/generate`,
    init,
  );
  const response = scheduleGenerateResponseApiSchema.parse(responseJson);
  return response;
}

export async function publishScheduleVersion(
  versionId: string,
): Promise<SchedulePublishResponse> {
  const responseJson = await requestJson<unknown>(
    `/schedule-versions/${versionId}/publish`,
    {
      method: "POST",
      cache: "no-store",
    },
  );
  const response = schedulePublishResponseApiSchema.parse(responseJson);
  return response;
}

export async function getProviderWeeklyAvailability(
  scheduleWeekId: string,
  providerId: string,
): Promise<ProviderWeeklyAvailabilityRecord> {
  const path = `/schedule-weeks/${scheduleWeekId}/providers/${providerId}/availability`;
  const responseJson = await requestJson<unknown>(path, { cache: "no-store" });
  const availability = providerWeeklyAvailabilityReadApiSchema.parse(responseJson);
  return availability;
}

export async function checkProviderSlotEligibility(
  payload: ProviderSlotEligibilityPayload,
): Promise<ProviderSlotEligibility> {
  const init = jsonRequestInit("POST", payload);
  const responseJson = await requestJson<unknown>("/schedule-provider-eligibility", init);
  const response = providerSlotEligibilityApiSchema.parse(responseJson);
  return response;
}

export async function saveProviderWeeklyAvailability(
  scheduleWeekId: string,
  providerId: string,
  availability: ProviderWeeklyAvailabilityRecord,
): Promise<ProviderWeeklyAvailabilityRecord> {
  const parsedAvailability = providerWeeklyAvailabilitySchema.parse(availability);
  const payloadData = {
    min_shifts_requested: parsedAvailability.minShiftsRequested,
    max_shifts_requested: parsedAvailability.maxShiftsRequested,
    days: parsedAvailability.days,
  };
  const payload = providerWeeklyAvailabilityReplaceApiSchema.parse(payloadData);
  const path = `/schedule-weeks/${scheduleWeekId}/providers/${providerId}/availability`;
  const init = jsonRequestInit("PUT", payload);
  const responseJson = await requestJson<unknown>(path, init);
  const savedAvailability = providerWeeklyAvailabilityReadApiSchema.parse(responseJson);
  return savedAvailability;
}

export async function deleteProviderWeeklyAvailability(
  scheduleWeekId: string,
  providerId: string,
): Promise<void> {
  const path = `/schedule-weeks/${scheduleWeekId}/providers/${providerId}/availability`;
  await requestJson<unknown>(path, { method: "DELETE", cache: "no-store" });
}
