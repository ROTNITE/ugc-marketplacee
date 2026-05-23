"use client";

import { type PointerEvent, type ReactNode, useState } from "react";

type SwipeDeckProps<T> = {
  item: T | null;
  empty: ReactNode;
  onSwipe(action: "like" | "dislike"): void;
  children(item: T): ReactNode;
};

export function SwipeDeck<T>({ children, empty, item, onSwipe }: SwipeDeckProps<T>) {
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragX, setDragX] = useState(0);

  if (!item) {
    return <>{empty}</>;
  }

  function beginDrag(event: PointerEvent<HTMLElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragStart(event.clientX);
  }

  function moveDrag(event: PointerEvent<HTMLElement>) {
    if (dragStart === null) {
      return;
    }

    setDragX(event.clientX - dragStart);
  }

  function endDrag() {
    if (dragX > 80) {
      onSwipe("like");
    } else if (dragX < -80) {
      onSwipe("dislike");
    }

    setDragStart(null);
    setDragX(0);
  }

  return (
    <article
      className="feed-card swipe-card"
      onPointerCancel={endDrag}
      onPointerDown={beginDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      style={{
        transform: `translateX(${dragX}px) rotate(${dragX / 28}deg)`
      }}
    >
      {children(item)}
    </article>
  );
}
