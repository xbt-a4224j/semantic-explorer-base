/**
 * Loading is a designed state, not a spinner: the skeleton has the shape of the result list,
 * so the layout does not jump when data arrives and the user can see what is coming.
 */
export function ResultsSkeleton() {
  return (
    <div className="results__skeleton" aria-busy="true" aria-label="loading results">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="skeleton skeleton--card">
          <div className="skeleton skeleton--line skeleton--title" />
          <div className="skeleton skeleton--line" />
          <div className="skeleton skeleton--line skeleton--short" />
        </div>
      ))}
    </div>
  )
}
