"use client";
import React from "react";
import { HiOutlinePlusSmall, HiOutlineTrash } from "react-icons/hi2";
import Link from "next/link";
import GoBack from "../../components/dashboard/GoBack";
import { pageRoutes } from "../../config/routes";
import MemberAvatar from "../group/MemberAvatar";
import {
	SavedBankAccount,
	SavedWallet,
	useWithdrawalAccountsStore,
} from "../../lib/store/withdrawal-accounts-store";
import { toast } from "../../lib/utils/toast";

interface AccountRowProps {
	name: string;
	subtitle: string;
	colorIndex: number;
	isDefault: boolean;
	onSetDefault: () => void;
	onDelete: () => void;
}

function AccountRow({
	name,
	subtitle,
	colorIndex,
	isDefault,
	onSetDefault,
	onDelete,
}: AccountRowProps) {
	return (
		<div className="flex items-center justify-between gap-3 py-3.5 border-b border-neutral-light last:border-b-0">
			<div className="flex items-center gap-3 min-w-0">
				<MemberAvatar name={name} colorIndex={colorIndex} size="w-10 h-10" />
				<div className="min-w-0">
					<p className="text-sm font-medium text-neutral-dark truncate">{name}</p>
					<p className="text-xs font-light text-neutral-light-active truncate">{subtitle}</p>
				</div>
			</div>
			<div className="flex items-center gap-3 shrink-0">
				{isDefault ? (
					<span className="text-[10px] font-medium bg-primary-light text-primary rounded-full px-2 py-1 whitespace-nowrap">
						Default
					</span>
				) : (
					<button
						type="button"
						onClick={onSetDefault}
						className="text-[10px] font-medium text-primary hover:text-primary-hover cursor-pointer bg-transparent border-0 whitespace-nowrap"
					>
						Set Default
					</button>
				)}
				<button
					type="button"
					onClick={onDelete}
					className="text-neutral-light-active hover:text-error-500 cursor-pointer bg-transparent border-0"
				>
					<HiOutlineTrash className="text-base" />
				</button>
			</div>
		</div>
	);
}

function SectionHeader({ title, addHref }: { title: string; addHref: string }) {
	return (
		<div className="flex items-center justify-between mb-1">
			<h4 className="text-xs font-light text-neutral-light-active">{title}</h4>
			<Link
				href={addHref}
				className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-hover"
			>
				<HiOutlinePlusSmall className="text-base" />
				Add New
			</Link>
		</div>
	);
}

function bankSubtitle(account: SavedBankAccount) {
	return `${account.bankName} · •••• ${account.accountNumber.slice(-4)}`;
}

function walletSubtitle(wallet: SavedWallet) {
	return `${wallet.network} · ${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`;
}

export default function SavedAccountsView() {
	const { bankAccounts, wallets, removeBankAccount, removeWallet, setDefaultBankAccount, setDefaultWallet } =
		useWithdrawalAccountsStore();

	const handleSetDefaultBank = (id: string) => {
		setDefaultBankAccount(id);
		toast.success("Your default withdrawal account has been updated", "Default Account Updated");
	};

	const handleDeleteBank = (account: SavedBankAccount) => {
		removeBankAccount(account.id);
		toast.error(`${account.bankName} account has been removed`, "Bank Account Deleted Successfully");
	};

	const handleSetDefaultWallet = (id: string) => {
		setDefaultWallet(id);
		toast.success("Your default withdrawal account has been updated", "Default Account Updated");
	};

	const handleDeleteWallet = (wallet: SavedWallet) => {
		removeWallet(wallet.id);
		toast.error(`${wallet.network} wallet has been removed`, "Wallet Deleted Successfully");
	};

	return (
		<div className="mx-auto md:max-w-xl lg:max-w-2xl w-full px-0 sm:px-4 py-2">
			<div className="space-y-6">
				<GoBack />

				<h2 className="text-xl font-semibold text-neutral-dark">Saved Accounts</h2>

				<div>
					<SectionHeader
						title="Bank Accounts"
						addHref={pageRoutes.dashboardRoutes.PROFILE_WITHDRAWAL_BANK_INFO}
					/>
					{bankAccounts.length > 0 ? (
						<div className="bg-white border border-neutral-light rounded-[20px] px-4 md:px-5">
							{bankAccounts.map((account, index) => (
								<AccountRow
									key={account.id}
									name={account.accountName}
									subtitle={bankSubtitle(account)}
									colorIndex={index}
									isDefault={account.isDefault}
									onSetDefault={() => handleSetDefaultBank(account.id)}
									onDelete={() => handleDeleteBank(account)}
								/>
							))}
						</div>
					) : (
						<div className="flex items-center justify-center py-8 rounded-[15px] border border-dashed border-neutral-light-hover">
							<p className="text-xs font-light text-neutral-light-active">
								No bank accounts added
							</p>
						</div>
					)}
				</div>

				<div>
					<SectionHeader
						title="Wallets"
						addHref={pageRoutes.dashboardRoutes.PROFILE_WITHDRAWAL_WALLET_ADDRESS}
					/>
					{wallets.length > 0 ? (
						<div className="bg-white border border-neutral-light rounded-[20px] px-4 md:px-5">
							{wallets.map((wallet, index) => (
								<AccountRow
									key={wallet.id}
									name={wallet.accountName}
									subtitle={walletSubtitle(wallet)}
									colorIndex={index + 1}
									isDefault={wallet.isDefault}
									onSetDefault={() => handleSetDefaultWallet(wallet.id)}
									onDelete={() => handleDeleteWallet(wallet)}
								/>
							))}
						</div>
					) : (
						<div className="flex items-center justify-center py-8 rounded-[15px] border border-dashed border-neutral-light-hover">
							<p className="text-xs font-light text-neutral-light-active">
								No wallets added
							</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
