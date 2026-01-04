import { useCallback, useRef, useEffect } from 'react';

/**
 * Hook for spreadsheet-style keyboard navigation
 * Supports arrow keys, Tab, Enter, and Escape
 *
 * @param {Object} options
 * @param {number} options.rowCount - Total number of rows
 * @param {number} options.colCount - Total number of columns
 * @param {Object} options.focusedCell - { rowIndex, colIndex }
 * @param {Function} options.setFocusedCell - Setter for focused cell
 * @param {boolean} options.isEditing - Whether currently in edit mode
 * @param {Function} options.setIsEditing - Setter for edit mode
 * @param {Function} options.onAddRow - Callback when navigating past last row
 * @param {Object} options.cellRefs - Map of "row-col" to ref for focusing
 */
export function useSpreadsheetNavigation({
  rowCount,
  colCount,
  focusedCell,
  setFocusedCell,
  isEditing,
  setIsEditing,
  onAddRow,
  cellRefs
}) {
  const containerRef = useRef(null);

  // Move focus in a direction
  const moveFocus = useCallback((deltaCol, deltaRow) => {
    setFocusedCell(prev => {
      let newRow = prev.rowIndex + deltaRow;
      let newCol = prev.colIndex + deltaCol;

      // Wrap columns
      if (newCol < 0) {
        newCol = colCount - 1;
        newRow = Math.max(0, newRow - 1);
      } else if (newCol >= colCount) {
        newCol = 0;
        newRow = newRow + 1;
      }

      // Handle row bounds
      if (newRow < 0) {
        newRow = 0;
      } else if (newRow >= rowCount) {
        // If navigating past last row, trigger add row
        if (onAddRow) {
          onAddRow();
          return { rowIndex: rowCount, colIndex: 0 }; // Will be new row
        }
        newRow = rowCount - 1;
      }

      return { rowIndex: newRow, colIndex: newCol };
    });
  }, [colCount, rowCount, setFocusedCell, onAddRow]);

  // Move to next cell (Tab/Enter behavior)
  const moveToNextCell = useCallback(() => {
    moveFocus(1, 0);
    setIsEditing(false);
  }, [moveFocus, setIsEditing]);

  // Move to previous cell (Shift+Tab)
  const moveToPrevCell = useCallback(() => {
    moveFocus(-1, 0);
    setIsEditing(false);
  }, [moveFocus, setIsEditing]);

  // Handle keyboard events
  const handleKeyDown = useCallback((e) => {
    // Don't intercept if in an input/select and typing
    const isInputElement = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);

    if (isEditing) {
      // When editing, Tab/Enter moves to next cell
      if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) {
          moveToPrevCell();
        } else {
          moveToNextCell();
        }
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !isInputElement) {
        e.preventDefault();
        moveToNextCell();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsEditing(false);
        return;
      }
      // Let other keys pass through to input
      return;
    }

    // Not editing - arrow key navigation
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        moveFocus(0, -1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveFocus(0, 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        moveFocus(-1, 0);
        break;
      case 'ArrowRight':
        e.preventDefault();
        moveFocus(1, 0);
        break;
      case 'Tab':
        e.preventDefault();
        if (e.shiftKey) {
          moveToPrevCell();
        } else {
          moveToNextCell();
        }
        break;
      case 'Enter':
        e.preventDefault();
        setIsEditing(true);
        break;
      case ' ':
        // Space starts editing (for checkboxes, etc.)
        if (!isInputElement) {
          e.preventDefault();
          setIsEditing(true);
        }
        break;
      default:
        // Start editing on any printable key
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          setIsEditing(true);
        }
        break;
    }
  }, [isEditing, moveFocus, moveToNextCell, moveToPrevCell, setIsEditing]);

  // Focus the appropriate cell when focusedCell changes
  useEffect(() => {
    if (cellRefs?.current) {
      const key = `${focusedCell.rowIndex}-${focusedCell.colIndex}`;
      const cellRef = cellRefs.current[key];
      if (cellRef?.focus) {
        cellRef.focus();
      }
    }
  }, [focusedCell, cellRefs]);

  return {
    containerRef,
    handleKeyDown,
    focusedCell,
    isEditing,
    moveFocus,
    moveToNextCell,
    moveToPrevCell
  };
}

export default useSpreadsheetNavigation;
