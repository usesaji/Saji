import * as React from "react";
import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";
import { FiLoader } from "react-icons/fi";

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[40px] lg:rounded-[66px] text-sm sm:text-base lg:text-lg transition-all disabled:pointer-events-none disabled:bg-primary-400 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-none focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive cursor-pointer duration-150 hover:scale-[0.95] active:scale-[0.98]",
	{
		variants: {
			variant: {
				default:
					"bg-primary text-white hover:bg-primary-hover disabled:bg-[#DCDDDE] disabled:text-[#B7B9BB]",
				destructive:
					"bg-error-500 text-white hover:bg-error-500/80 focus-visible:ring-destructive/20",
				outline: "border border-primary-500",
				secondary: "bg-primary-darker hover:bg-primary-darker-hover text-white",
				ghost: "bg-primary-50 hover:bg-primary-500 hover:text-white",
				dark: "bg-neutral-dark bg-neutral-dark-hover text-white hover:bg-neutral-dark-hover",
			},
			size: {
				default: "w-fit h-[43px] px-5.5 py-3 lg:h-[48px] has-[>svg]:px-3",
				sm: "h-[43px] rounded-[24px] gap-1.5 px-3 has-[>svg]:px-2.5",
				lg: "h-[60px] rounded-[30px] px-6 has-[>svg]:px-4",
				icon: "size-9",
				"icon-sm": "size-8",
				"icon-lg": "size-10",
			},
			// size: {
			// 	default: "w-full h-[43px] px-4 py-2 lg:h-[48px] has-[>svg]:px-3",
			// 	sm: "h-[43px] rounded-[24px] gap-1.5 px-3 has-[>svg]:px-2.5",
			// 	lg: "h-[60px] rounded-[30px] px-6 has-[>svg]:px-4",
			// 	icon: "size-9",
			// 	"icon-sm": "size-8",
			// 	"icon-lg": "size-10",
			// },
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

type BaseButtonProps = VariantProps<typeof buttonVariants> & {
	className?: string;
	children: React.ReactNode;
	isLoading?: boolean;
};

type ButtonAsButton = BaseButtonProps &
	React.ButtonHTMLAttributes<HTMLButtonElement> & {
		href?: never;
	};

type ButtonAsLink = BaseButtonProps &
	React.AnchorHTMLAttributes<HTMLAnchorElement> & {
		href: string;
	};

type ButtonProps = ButtonAsButton | ButtonAsLink;

function Button(props: ButtonProps) {
	const {
		className,
		variant,
		size,
		isLoading = false,
		children,
		...rest
	} = props;

	const classes = cn(
		buttonVariants({ variant, size, className }),
		isLoading && "opacity-90 cursor-not-allowed",
	);

	if ("href" in props && props.href) {
		const href: string = props.href;
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { href: _href, onClick: consumerOnClick, ...restLinkProps } =
			rest as React.AnchorHTMLAttributes<HTMLAnchorElement>;

		const content = isLoading ? (
			<span className="flex items-center gap-2">
				<span className="opacity-80 animate-pulse">
					<FiLoader size={36} />
				</span>
			</span>
		) : (
			children
		);

		// Only attach a click handler when one is actually needed (loading-guard
		// or a caller-supplied onClick) — Button is often rendered from Server
		// Components for plain navigation, and passing a function prop to
		// next/link's Link (a Client Component) in that case throws "Event
		// handlers cannot be passed to Client Component props".
		const needsClickHandler = isLoading || Boolean(consumerOnClick);
		const handleClick: React.MouseEventHandler<HTMLAnchorElement> = (e) => {
			if (isLoading) {
				e.preventDefault();
				return;
			}
			consumerOnClick?.(e);
		};
		const clickHandlerProp = needsClickHandler ? { onClick: handleClick } : {};

		// Internal routes get real client-side transitions via next/link;
		// anything else (external URLs, mailto:, #anchors) stays a plain <a>.
		const isInternal = href.startsWith("/");

		if (isInternal) {
			return (
				<Link
					data-slot="button"
					href={href}
					className={classes}
					aria-disabled={isLoading}
					{...restLinkProps}
					{...clickHandlerProp}
				>
					{content}
				</Link>
			);
		}

		return (
			<a
				data-slot="button"
				href={href}
				className={classes}
				aria-disabled={isLoading}
				{...restLinkProps}
				{...clickHandlerProp}
			>
				{content}
			</a>
		);
	}

	const buttonProps = rest as React.ButtonHTMLAttributes<HTMLButtonElement>;

	return (
		<button
			data-slot="button"
			type={buttonProps.type ?? "button"}
			className={classes}
			disabled={isLoading || buttonProps.disabled}
			{...buttonProps}
		>
			{isLoading ? (
				<span className="flex items-center gap-2">
					<span className="animate-spin">
						<FiLoader size={36} />
					</span>
				</span>
			) : (
				children
			)}
		</button>
	);
}

export { Button, buttonVariants };
