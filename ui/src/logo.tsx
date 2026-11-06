/**
 * The Fibrous symbol from the brand kit (fibrous-symbol-signal.svg), in
 * `currentColor`: tokens.css colours it per theme. Inlined because the widget
 * is a single document with no network: an <img src> would be blocked by the
 * host's sandbox.
 */
export function FibrousLogo({ size = 20 }: { size?: number }) {
	return (
		<svg
			class="logo"
			width={(size * 71.55) / 88.76}
			height={size}
			viewBox="0 0 71.55 88.76"
			fill="currentColor"
			aria-hidden="true"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path d="M36.68,62.28H9.33c-2.69,0-4.87-2.18-4.87-4.87s2.18-4.87,4.87-4.87h27.35c2.14,0,3.89-1.74,3.89-3.89s-1.74-3.89-3.89-3.89h-18.59c-7.51,0-13.63-6.11-13.63-13.63s6.11-13.63,13.63-13.63h39.84c2.14,0,3.89-1.74,3.89-3.89s-1.74-3.89-3.89-3.89h-19.91c-2.69,0-4.87-2.18-4.87-4.87s2.18-4.87,4.87-4.87h19.91c7.51,0,13.63,6.11,13.63,13.63s-6.11,13.63-13.63,13.63H18.09c-2.14,0-3.89,1.74-3.89,3.89s1.74,3.89,3.89,3.89h18.59c7.51,0,13.63,6.11,13.63,13.63s-6.11,13.63-13.63,13.63Z" />
			<path d="M9.33,88.76c-5.15,0-9.33-4.19-9.33-9.33s4.19-9.33,9.33-9.33,9.33,4.19,9.33,9.33-4.19,9.33-9.33,9.33ZM9.33,75.51c-2.16,0-3.92,1.76-3.92,3.92s1.76,3.92,3.92,3.92,3.92-1.76,3.92-3.92-1.76-3.92-3.92-3.92Z" />
			<circle cx="24.36" cy="4.87" r="4.87" />
		</svg>
	);
}
