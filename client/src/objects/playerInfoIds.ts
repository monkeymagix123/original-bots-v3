/** Keep player-info IDs sorted without adding a second copy from a repeated update. */
export function insertPlayerInfoId(ids: number[], id: number): void {
    let left = 0;
    let right = ids.length;
    while (left < right) {
        const middle = (left + right) >>> 1;
        if (ids[middle] < id) left = middle + 1;
        else right = middle;
    }
    if (ids[left] !== id) ids.splice(left, 0, id);
}
