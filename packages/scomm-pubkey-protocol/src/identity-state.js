import { IDENTITY_UX_STATES } from "./constants.js";

/**
 * INVARIANT 8: A missing local MSK must never silently cause a new
 * MSK to be generated for an existing principal.
 */
export function resolveIdentityUxState({
	principalExists,
	localMsk,
	deviceAuthorized,
	enrollmentState,
	recoveryState,
	vaultSyncing,
	historicalKeysAvailable,
}) {
	if (recoveryState === "OTP_SENT" || recoveryState === "RECOVERY_REQUESTED") {
		return IDENTITY_UX_STATES.otpRequired;
	}
	if (recoveryState === "OTP_VERIFIED" || recoveryState === "NEW_MSK_SUBMITTED") {
		return IDENTITY_UX_STATES.newMskCreating;
	}
	if (recoveryState === "COMPLETE") {
		return historicalKeysAvailable === false
			? IDENTITY_UX_STATES.historicalKeysUnavailable
			: IDENTITY_UX_STATES.identityRecovered;
	}
	if (enrollmentState === "EXPIRED") return IDENTITY_UX_STATES.enrollmentExpired;
	if (enrollmentState === "REJECTED") return IDENTITY_UX_STATES.enrollmentRejected;
	if (
		enrollmentState === "WAITING_FOR_APPROVAL" ||
		enrollmentState === "QR_CREATED"
	) {
		return IDENTITY_UX_STATES.waitingForApproval;
	}
	if (enrollmentState && enrollmentState !== "ACTIVE") {
		return IDENTITY_UX_STATES.enrollmentPending;
	}
	if (!principalExists) return IDENTITY_UX_STATES.noIdentity;
	if (!localMsk && !deviceAuthorized) {
		return IDENTITY_UX_STATES.unauthorized;
	}
	if (deviceAuthorized === false) return IDENTITY_UX_STATES.unauthorized;
	if (vaultSyncing) return IDENTITY_UX_STATES.vaultSyncing;
	return IDENTITY_UX_STATES.authorized;
}

export function mustNotGenerateMsk({ principalExists, localMsk, explicitRecovery }) {
	return Boolean(principalExists && !localMsk && !explicitRecovery);
}
