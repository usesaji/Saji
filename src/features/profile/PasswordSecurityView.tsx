"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { HiArrowLeft, HiOutlineShieldCheck } from "react-icons/hi2";
import { Button } from "../../components/ui/button";
import InputField from "../../components/ui/custom/InputField";
import { toast } from "../../lib/utils/toast";
import ProfileMenuList from "./ProfileMenuList";
import SecurityToggleRow from "./SecurityToggleRow";

type View = "password" | "security-settings";

// Demo-only: simulates the account's real current password so the
// "Incorrect Password" state has a deterministic way to be reproduced.
const DEMO_CORRECT_PASSWORD = "password123";

export default function PasswordSecurityView() {
	const router = useRouter();
	const [view, setView] = useState<View>("password");

	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [hasPasswordError, setHasPasswordError] = useState(false);
	const [isSavingPassword, setIsSavingPassword] = useState(false);

	const [twoFactorOnWithdrawal, setTwoFactorOnWithdrawal] = useState(false);
	const [lockAfterFailedAttempts, setLockAfterFailedAttempts] = useState(false);
	const [savedToggles, setSavedToggles] = useState({ twoFactor: false, lock: false });
	const [isSavingToggles, setIsSavingToggles] = useState(false);

	const handleBack = () => {
		if (view === "security-settings") {
			setView("password");
			return;
		}
		router.back();
	};

	const canSubmitPassword =
		currentPassword.trim().length > 0 &&
		newPassword.trim().length >= 6 &&
		newPassword === confirmPassword;

	const handleSavePassword = async () => {
		if (!canSubmitPassword) return;
		setIsSavingPassword(true);
		setHasPasswordError(false);

		await new Promise((resolve) => setTimeout(resolve, 1000));
		setIsSavingPassword(false);

		if (currentPassword !== DEMO_CORRECT_PASSWORD) {
			setHasPasswordError(true);
			toast.error("Password is incorrect, try again.", "Incorrect Password");
			return;
		}

		setCurrentPassword("");
		setNewPassword("");
		setConfirmPassword("");
		toast.success("Your password has been updated", "Password Changed");
	};

	const togglesDirty =
		twoFactorOnWithdrawal !== savedToggles.twoFactor ||
		lockAfterFailedAttempts !== savedToggles.lock;

	const handleSaveToggles = async () => {
		if (!togglesDirty) return;
		setIsSavingToggles(true);

		await new Promise((resolve) => setTimeout(resolve, 800));
		setIsSavingToggles(false);

		setSavedToggles({ twoFactor: twoFactorOnWithdrawal, lock: lockAfterFailedAttempts });
		toast.success("Your security settings have been updated", "Changes Saved");
	};

	return (
		<div className="mx-auto md:max-w-xl lg:max-w-2xl w-full px-0 sm:px-4 py-2">
			<div className="space-y-6">
				<button
					type="button"
					onClick={handleBack}
					className="cursor-pointer w-fit flex items-center gap-2 bg-transparent border-0"
				>
					<HiArrowLeft className="text-xl md:text-2xl" />
					<span>Back</span>
				</button>

				<h2 className="text-xl font-semibold text-neutral-dark">Password &amp; Security</h2>

				{view === "password" ? (
					<>
						<div>
							<InputField
								name="currentPassword"
								label="Enter Current Password"
								type="password"
								value={currentPassword}
								onChange={(e) => setCurrentPassword(e.target.value)}
								error={hasPasswordError ? "Incorrect password" : null}
							/>
							<p className="text-[11px] font-light text-neutral-light-active mt-1.5 ml-1">
								Password last changed 23 days ago
							</p>
						</div>

						<InputField
							name="newPassword"
							label="Enter New Password"
							type="password"
							value={newPassword}
							onChange={(e) => setNewPassword(e.target.value)}
							error={hasPasswordError ? "Incorrect password" : null}
						/>

						<InputField
							name="confirmPassword"
							label="Confirm New Password"
							type="password"
							value={confirmPassword}
							onChange={(e) => setConfirmPassword(e.target.value)}
							error={hasPasswordError ? "Incorrect password" : null}
						/>

						<ProfileMenuList
							items={[
								{
									key: "security-settings",
									icon: <HiOutlineShieldCheck />,
									label: "Security Settings",
									onClick: () => setView("security-settings"),
								},
							]}
						/>

						<Button
							type="button"
							onClick={handleSavePassword}
							disabled={!canSubmitPassword}
							isLoading={isSavingPassword}
							className="w-full"
						>
							Save Changes
						</Button>
					</>
				) : (
					<>
						<div className="bg-white border border-neutral-light rounded-[20px] px-4 md:px-5">
							<SecurityToggleRow
								label="2FA on suspicious withdrawal"
								description="Confirm withdrawal during suspicious attempts."
								checked={twoFactorOnWithdrawal}
								onChange={setTwoFactorOnWithdrawal}
							/>
							<SecurityToggleRow
								label="Lock after 5 failed attempts"
								description="Restrict access after 5 failed attempts."
								checked={lockAfterFailedAttempts}
								onChange={setLockAfterFailedAttempts}
							/>
						</div>

						<Button
							type="button"
							onClick={handleSaveToggles}
							disabled={!togglesDirty}
							isLoading={isSavingToggles}
							className="w-full"
						>
							Save Changes
						</Button>
					</>
				)}
			</div>
		</div>
	);
}
