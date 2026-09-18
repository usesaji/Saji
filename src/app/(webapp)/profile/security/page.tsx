"use client";

import { useEffect, useState } from "react";
import GoBack from "@/components/dashboard/GoBack";
import InputField from "@/components/ui/custom/InputField";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/hooks/useApi";
import { profile as profileApi, fieldErrors, ApiError } from "@/lib/api";
import { toast } from "@/lib/utils/toast";

/** Password & Security — change password and manage security toggles. */
export default function SecurityPage() {
	const { data } = useApi(() => profileApi.show(), []);

	// --- Password change ---
	const [pwd, setPwd] = useState({
		current_password: "",
		password: "",
		password_confirmation: "",
	});
	const [pwdErrors, setPwdErrors] = useState<Record<string, string>>({});
	const [savingPwd, setSavingPwd] = useState(false);

	const hasPassword = data?.has_password ?? true;

	const setP = (key: keyof typeof pwd) => (e: React.ChangeEvent<HTMLInputElement>) =>
		setPwd((p) => ({ ...p, [key]: e.target.value }));

	const submitPwd = async (e: React.FormEvent) => {
		e.preventDefault();
		setSavingPwd(true);
		setPwdErrors({});
		try {
			await profileApi.changePassword({
				password: pwd.password,
				password_confirmation: pwd.password_confirmation,
				...(hasPassword ? { current_password: pwd.current_password } : {}),
			});
			toast.success("Other sessions were signed out.", "Password updated");
			setPwd({ current_password: "", password: "", password_confirmation: "" });
		} catch (err) {
			setPwdErrors(fieldErrors(err));
			toast.error(
				err instanceof ApiError ? err.message : "Something went wrong.",
				"Could not update password",
			);
		} finally {
			setSavingPwd(false);
		}
	};

	// --- Security toggles ---
	const [twofa, setTwofa] = useState(false);
	const [lockAfter, setLockAfter] = useState(0);
	const [savingSec, setSavingSec] = useState(false);

	useEffect(() => {
		if (!data) return;
		setTwofa(data.security.twofa_on_suspicious_withdrawal);
		setLockAfter(data.security.lock_after_failed_attempts);
	}, [data]);

	const submitSecurity = async (nextTwofa: boolean, nextLock: number) => {
		setSavingSec(true);
		try {
			await profileApi.updateSecurity({
				twofa_on_suspicious_withdrawal: nextTwofa,
				lock_after_failed_attempts: nextLock,
			});
			setTwofa(nextTwofa);
			setLockAfter(nextLock);
			toast.success("", "Security updated");
		} catch (err) {
			toast.error(
				err instanceof ApiError ? err.message : "Something went wrong.",
				"Could not update",
			);
		} finally {
			setSavingSec(false);
		}
	};

	return (
		<div>
			<GoBack />
			<h2 className="mt-4 text-xl font-light md:text-3xl md:font-normal">
				Password & Security
			</h2>

			{/* Change password */}
			<form onSubmit={submitPwd} className="mt-6 max-w-lg space-y-5">
				<h3 className="md:text-xl">
					{hasPassword ? "Change Password" : "Set a Password"}
				</h3>

				{hasPassword && (
					<InputField
						name="current_password"
						label="Current Password"
						type="password"
						value={pwd.current_password}
						onChange={setP("current_password")}
						error={pwdErrors.current_password}
					/>
				)}
				<InputField
					name="password"
					label="New Password"
					type="password"
					value={pwd.password}
					onChange={setP("password")}
					error={pwdErrors.password}
				/>
				<InputField
					name="password_confirmation"
					label="Confirm New Password"
					type="password"
					value={pwd.password_confirmation}
					onChange={setP("password_confirmation")}
					error={pwdErrors.password}
				/>

				<Button type="submit" isLoading={savingPwd} className="w-full">
					{hasPassword ? "Update Password" : "Set Password"}
				</Button>
			</form>

			{/* Security toggles */}
			<section className="mt-10 max-w-lg space-y-4">
				<h3 className="md:text-xl">Security Settings</h3>

				<div className="flex items-center justify-between gap-4 rounded-2xl bg-[#f7f7f7] p-4 md:p-6">
					<div>
						<p className="text-sm font-medium md:text-base">
							2FA on suspicious withdrawal
						</p>
						<p className="text-xs font-light text-muted-foreground">
							Require an extra check for unusual withdrawals.
						</p>
					</div>
					<Button
						variant={twofa ? "default" : "outline"}
						size="sm"
						isLoading={savingSec}
						onClick={() => submitSecurity(!twofa, lockAfter)}
					>
						{twofa ? "On" : "Off"}
					</Button>
				</div>

				<div className="flex items-center justify-between gap-4 rounded-2xl bg-[#f7f7f7] p-4 md:p-6">
					<div>
						<p className="text-sm font-medium md:text-base">
							Lock after failed logins
						</p>
						<p className="text-xs font-light text-muted-foreground">
							{lockAfter > 0
								? `Locks after ${lockAfter} failed attempts.`
								: "Lockout disabled."}
						</p>
					</div>
					<Button
						variant={lockAfter > 0 ? "default" : "outline"}
						size="sm"
						isLoading={savingSec}
						onClick={() => submitSecurity(twofa, lockAfter > 0 ? 0 : 5)}
					>
						{lockAfter > 0 ? "Disable" : "Enable (5)"}
					</Button>
				</div>
			</section>
		</div>
	);
}
