import React from "react";
import { Button } from "../ui/button";
import Logo from "./Logo";

interface ErrorAction {
	label: string;
	href?: string;
	onClick?: () => void;
	isLoading?: boolean;
}

interface ErrorStateProps {
	icon: React.ReactNode;
	code?: string;
	heading: string;
	description: string;
	primaryAction: ErrorAction;
	secondaryAction?: ErrorAction;
}

export default function ErrorState({
	icon,
	code,
	heading,
	description,
	primaryAction,
	secondaryAction,
}: ErrorStateProps) {
	return (
		<div className="min-h-screen w-full flex flex-col items-center justify-center px-4 py-10 text-center">
			<div className="mb-8">
				<Logo />
			</div>

			<span className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-primary-light flex items-center justify-center text-primary text-3xl md:text-4xl">
				{icon}
			</span>

			{code && (
				<p className="text-xs font-semibold tracking-[0.2em] text-primary mt-6">
					{code}
				</p>
			)}

			<h1 className="text-xl md:text-3xl font-semibold text-neutral-dark mt-2 max-w-md">
				{heading}
			</h1>
			<p className="text-sm font-light text-neutral-light-active mt-3 max-w-sm leading-relaxed">
				{description}
			</p>

			<div className="flex flex-wrap items-center justify-center gap-3 mt-8">
				{primaryAction.href ? (
					<Button href={primaryAction.href} isLoading={primaryAction.isLoading}>
						{primaryAction.label}
					</Button>
				) : (
					<Button
						type="button"
						onClick={primaryAction.onClick}
						isLoading={primaryAction.isLoading}
					>
						{primaryAction.label}
					</Button>
				)}

				{secondaryAction &&
					(secondaryAction.href ? (
						<Button href={secondaryAction.href} variant="outline">
							{secondaryAction.label}
						</Button>
					) : (
						<Button type="button" onClick={secondaryAction.onClick} variant="outline">
							{secondaryAction.label}
						</Button>
					))}
			</div>
		</div>
	);
}
