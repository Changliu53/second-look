/**
 * Ready-made inputs for the paste page, so a visitor can see a review without
 * finding code to paste. Each one is the kind of change an AI tool produces
 * for someone who cannot review it themselves.
 */

export type PasteExample = {
  label: string;
  description: string;
  code: string;
};

const TENANT_QUERY = `using Microsoft.EntityFrameworkCore;

public class WorkOrderService
{
    private readonly PlatformDbContext _db;
    private readonly ITenantContext _tenant;

    public WorkOrderService(PlatformDbContext db, ITenantContext tenant)
    {
        _db = db;
        _tenant = tenant;
    }

    public async Task<List<WorkOrder>> ListOpenAsync(CancellationToken ct)
    {
        return await _db.WorkOrders
            .Where(w => w.TenantId == _tenant.TenantId && w.Status == WorkOrderStatus.Open)
            .ToListAsync(ct);
    }

    public async Task<List<WorkOrder>> SearchByCustomerAsync(string customerName, CancellationToken ct)
    {
        return await _db.WorkOrders
            .Where(w => w.CustomerName.Contains(customerName))
            .Take(50)
            .ToListAsync(ct);
    }

    public async Task CloseAsync(int id, string closedBy, CancellationToken ct)
    {
        var workOrder = await _db.WorkOrders.FirstAsync(w => w.Id == id, ct);
        workOrder.Status = WorkOrderStatus.Closed;
        workOrder.ClosedBy = closedBy;
        await _db.SaveChangesAsync(ct);
    }
}`;

const EF_MIGRATION = `using Microsoft.EntityFrameworkCore.Migrations;

public partial class RenameCustomerPhone : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(
            name: "Phone",
            table: "Customers");

        migrationBuilder.AddColumn<string>(
            name: "PrimaryPhone",
            table: "Customers",
            type: "nvarchar(32)",
            maxLength: 32,
            nullable: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(
            name: "PrimaryPhone",
            table: "Customers");

        migrationBuilder.AddColumn<string>(
            name: "Phone",
            table: "Customers",
            type: "nvarchar(32)",
            maxLength: 32,
            nullable: true);
    }
}`;

const REACT_FETCH = `import { useEffect, useState } from "react";
import { formatCurrency } from "lodash";

export function InvoiceTotal({ invoiceId }: { invoiceId: string }) {
  const [total, setTotal] = useState(0);

  useEffect(() => {
    fetch("/api/invoices/" + invoiceId)
      .then((res) => res.json())
      .then((invoice) => {
        let sum = 0;
        for (let i = 0; i <= invoice.lines.length; i++) {
          sum += invoice.lines[i].amount;
        }
        setTotal(sum);
      });
  });

  return <p>Total: {formatCurrency(total)}</p>;
}`;

export const PASTE_EXAMPLES: PasteExample[] = [
  {
    label: "C#: query on tenant data",
    description: "Add work order search and close for office staff.",
    code: TENANT_QUERY,
  },
  {
    label: "EF Core: migration",
    description: "Rename the Customers.Phone column to PrimaryPhone.",
    code: EF_MIGRATION,
  },
  {
    label: "React: invoice total",
    description: "Show the total of an invoice.",
    code: REACT_FETCH,
  },
];
