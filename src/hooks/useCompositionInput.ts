import { useRef, useCallback } from "react";

type InputEl = HTMLInputElement | HTMLTextAreaElement;

/**
 * Korean IME composition-safe input handler.
 * Prevents React controlled inputs from interfering with IME composition.
 */
export function useCompositionInput(onChange: (value: string) => void) {
  const isComposing = useRef(false);

  const handleChange = useCallback(
    (e: React.ChangeEvent<InputEl>) => {
      if (isComposing.current) return;
      onChange(e.target.value);
    },
    [onChange],
  );

  const handleCompositionStart = useCallback(() => {
    isComposing.current = true;
  }, []);

  const handleCompositionEnd = useCallback(
    (e: React.CompositionEvent<InputEl>) => {
      isComposing.current = false;
      onChange(e.currentTarget.value);
    },
    [onChange],
  );

  return {
    isComposing,
    handleChange,
    handleCompositionStart,
    handleCompositionEnd,
    /** Spread onto <input> or <textarea> */
    compositionProps: {
      onChange: handleChange,
      onCompositionStart: handleCompositionStart,
      onCompositionEnd: handleCompositionEnd,
    },
  };
}
