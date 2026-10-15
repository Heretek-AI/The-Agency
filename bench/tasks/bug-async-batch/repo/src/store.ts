export interface Record {
  id: string
  value: number
}

export class Store {
  readonly rows: Record[] = []

  async save(row: Record): Promise<void> {
    await new Promise((r) => setTimeout(r, Math.random() * 5))
    this.rows.push(row)
  }
}
