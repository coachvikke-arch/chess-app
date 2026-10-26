import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import './button.css';

/**
 * The app's single action button.
 *
 * The visual baseline is the Student Tournaments "View results →" control:
 * a flat blue (#2563eb) fill, white 700-weight label, 10px radius, a soft
 * 1px drop shadow and a 2px offset focus ring. Hover deepens the blue,
 * pressing nudges the face down by 1%, and disabled actions turn into a
 * neutral grey chip. Every real action button in the app should use this
 * component so those states stay identical everywhere.
 *
 * Renders:
 *   - <Link>  when `to` is supplied
 *   - <a>     when `href` is supplied
 *   - <button> otherwise
 *
 * Props
 *   variant     primary | secondary | danger | ghost   (default primary)
 *   size        sm | md | lg                           (default md)
 *   icon        node shown before the label (or after it with iconPosition="right")
 *   iconPosition left | right                          (default left)
 *   iconRight   shorthand for an icon on the right
 *   fullWidth   stretch to the container width
 *   disabled    native disabled state + grey styling
 *   loading     shows a spinner, disables the control, keeps the label
 *   children    button label
 *   ...rest     any other prop is forwarded (onClick, type, to, href, title, …)
 */
const Button = forwardRef(function Button(
  {
    variant = 'primary',
    size = 'md',
    icon,
    iconPosition = 'left',
    iconRight,
    fullWidth = false,
    disabled = false,
    loading = false,
    className = '',
    children,
    to,
    href,
    type,
    ...rest
  },
  ref
) {
  const rightIcon = iconRight ?? (iconPosition === 'right' ? icon : null);
  const leftIcon = iconPosition === 'right' ? null : icon;
  const isDisabled = disabled || loading;

  const classes = [
    'app-btn',
    `app-btn--${variant}`,
    `app-btn--${size}`,
    fullWidth ? 'app-btn--full' : '',
    isDisabled ? 'app-btn--disabled' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      {leftIcon != null && (
        <span className="app-btn__icon" aria-hidden="true">
          {leftIcon}
        </span>
      )}
      {loading && <span className="app-btn__spinner" aria-hidden="true" />}
      {children != null && <span className="app-btn__label">{children}</span>}
      {rightIcon != null && (
        <span className="app-btn__icon app-btn__icon--right" aria-hidden="true">
          {rightIcon}
        </span>
      )}
    </>
  );

  if (to != null) {
    return (
      <Link ref={ref} to={to} className={classes} aria-disabled={isDisabled || undefined} {...rest}>
        {content}
      </Link>
    );
  }

  if (href != null) {
    return (
      <a ref={ref} href={href} className={classes} aria-disabled={isDisabled || undefined} {...rest}>
        {content}
      </a>
    );
  }

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...rest}
    >
      {content}
    </button>
  );
});

export default Button;
