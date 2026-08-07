import { create } from "zustand";

export interface SavedBankAccount {
	id: string;
	bankName: string;
	accountNumber: string;
	accountName: string;
	isDefault: boolean;
}

export interface SavedWallet {
	id: string;
	network: string;
	address: string;
	accountName: string;
	isDefault: boolean;
}

interface WithdrawalAccountsState {
	bankAccounts: SavedBankAccount[];
	wallets: SavedWallet[];
	addBankAccount: (account: Omit<SavedBankAccount, "id" | "isDefault">) => void;
	addWallet: (wallet: Omit<SavedWallet, "id" | "isDefault">) => void;
	removeBankAccount: (id: string) => void;
	removeWallet: (id: string) => void;
	setDefaultBankAccount: (id: string) => void;
	setDefaultWallet: (id: string) => void;
}

export const useWithdrawalAccountsStore = create<WithdrawalAccountsState>((set) => ({
	bankAccounts: [
		{
			id: "bank-1",
			bankName: "Union Bank",
			accountNumber: "1234567890",
			accountName: "Dean Ogude",
			isDefault: true,
		},
	],
	wallets: [
		{
			id: "wallet-1",
			network: "Stellar Testnet",
			address: "GB5QZ3K7L2XJY8N6R4WFM9PTCVHDAEUSIKGNQY7B3LZXM5RJ2TC8VQNP",
			accountName: "Dean Ogude",
			isDefault: true,
		},
	],

	addBankAccount: (account) =>
		set((state) => ({
			bankAccounts: [
				...state.bankAccounts,
				{
					...account,
					id: `bank-${Date.now()}`,
					isDefault: state.bankAccounts.length === 0,
				},
			],
		})),

	addWallet: (wallet) =>
		set((state) => ({
			wallets: [
				...state.wallets,
				{
					...wallet,
					id: `wallet-${Date.now()}`,
					isDefault: state.wallets.length === 0,
				},
			],
		})),

	removeBankAccount: (id) =>
		set((state) => ({
			bankAccounts: state.bankAccounts.filter((account) => account.id !== id),
		})),

	removeWallet: (id) =>
		set((state) => ({
			wallets: state.wallets.filter((wallet) => wallet.id !== id),
		})),

	setDefaultBankAccount: (id) =>
		set((state) => ({
			bankAccounts: state.bankAccounts.map((account) => ({
				...account,
				isDefault: account.id === id,
			})),
		})),

	setDefaultWallet: (id) =>
		set((state) => ({
			wallets: state.wallets.map((wallet) => ({
				...wallet,
				isDefault: wallet.id === id,
			})),
		})),
}));
