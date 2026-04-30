import { centerSchema, type CenterFormValues } from "@/lib/schemas/center";
import { nextPublicApiBaseUrl } from "@/lib/env";
import { providerSchema, type ProviderFormValues } from "@/lib/schemas/provider";
import { roomSchema, type RoomFormValues } from "@/lib/schemas/room";

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
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Provider = {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  provider_type: string;
  employment_type: string;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
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

export async function deactivateRoom(roomId: string): Promise<Room> {
  const room = await requestJson<Room>(`/rooms/${roomId}`, {
    method: "DELETE",
    cache: "no-store",
  });
  return room;
}

export async function listProviders(): Promise<Provider[]> {
  const providers = await requestJson<Provider[]>("/providers", { cache: "no-store" });
  return providers;
}

export async function getProvider(providerId: string): Promise<Provider> {
  const provider = await requestJson<Provider>(`/providers/${providerId}`, { cache: "no-store" });
  return provider;
}

export async function createProvider(values: ProviderFormValues): Promise<Provider> {
  const parsedValues = providerSchema.parse(values);
  const payload = providerPayload(parsedValues);
  const init = jsonRequestInit("POST", payload);
  const provider = await requestJson<Provider>("/providers", init);
  return provider;
}

export async function updateProvider(
  providerId: string,
  values: ProviderFormValues,
): Promise<Provider> {
  const parsedValues = providerSchema.parse(values);
  const payload = providerPayload(parsedValues);
  const init = jsonRequestInit("PATCH", payload);
  const provider = await requestJson<Provider>(`/providers/${providerId}`, init);
  return provider;
}

export async function deactivateProvider(providerId: string): Promise<Provider> {
  const provider = await requestJson<Provider>(`/providers/${providerId}`, {
    method: "DELETE",
    cache: "no-store",
  });
  return provider;
}
