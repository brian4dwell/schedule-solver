const clerkOrganizationAdminRole = "org:admin";
const scheduleSolverAdminRole = "admin";

export type ScheduleSolverPublicMetadata = {
  role?: unknown;
  roles?: unknown;
};

type UnknownRecord = Record<string, unknown>;

function valueIsAdminRole(value: unknown) {
  const valueIsString = typeof value === "string";

  if (!valueIsString) {
    return false;
  }

  const valueIsAdmin = value === scheduleSolverAdminRole;
  return valueIsAdmin;
}

function valueListHasAdminRole(value: unknown) {
  const valueIsList = Array.isArray(value);

  if (!valueIsList) {
    return false;
  }

  const hasAdminRole = value.some((item) => {
    const itemIsAdminRole = valueIsAdminRole(item);
    return itemIsAdminRole;
  });

  return hasAdminRole;
}

function valueIsRecord(value: unknown): value is UnknownRecord {
  const valueIsObject = typeof value === "object";
  const valueIsPresent = value !== null;
  const valueIsRecordType = valueIsObject && valueIsPresent;

  return valueIsRecordType;
}

function publicMetadataFromValue(value: unknown): ScheduleSolverPublicMetadata | null {
  const valueCanBeRead = valueIsRecord(value);

  if (!valueCanBeRead) {
    return null;
  }

  const publicMetadata = {
    role: value.role,
    roles: value.roles,
  };

  return publicMetadata;
}

function sessionPublicMetadataFromValue(value: unknown): ScheduleSolverPublicMetadata | null {
  const valueCanBeRead = valueIsRecord(value);

  if (!valueCanBeRead) {
    return null;
  }

  const publicMetadata = publicMetadataFromValue(value.public_metadata);
  return publicMetadata;
}

export function userHasAdminRole(
  organizationRole: string | null | undefined,
  publicMetadataValue: unknown,
  sessionClaimsValue?: unknown,
) {
  const publicMetadata = publicMetadataFromValue(publicMetadataValue);
  const sessionClaims = valueIsRecord(sessionClaimsValue) ? sessionClaimsValue : null;
  const sessionPublicMetadata = sessionPublicMetadataFromValue(sessionClaimsValue);
  const hasOrganizationAdminRole = organizationRole === clerkOrganizationAdminRole;
  const hasPublicMetadataRole = valueIsAdminRole(publicMetadata?.role);
  const hasPublicMetadataRoles = valueListHasAdminRole(publicMetadata?.roles);
  const hasSessionClaimRole = valueIsAdminRole(sessionClaims?.role);
  const hasSessionClaimRoles = valueListHasAdminRole(sessionClaims?.roles);
  const hasSessionPublicMetadataRole = valueIsAdminRole(sessionPublicMetadata?.role);
  const hasSessionPublicMetadataRoles = valueListHasAdminRole(
    sessionPublicMetadata?.roles,
  );
  const hasAdminRole =
    hasOrganizationAdminRole ||
    hasPublicMetadataRole ||
    hasPublicMetadataRoles ||
    hasSessionClaimRole ||
    hasSessionClaimRoles ||
    hasSessionPublicMetadataRole ||
    hasSessionPublicMetadataRoles;

  return hasAdminRole;
}
