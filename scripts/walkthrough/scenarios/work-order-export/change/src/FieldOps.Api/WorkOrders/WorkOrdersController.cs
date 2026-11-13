using FieldOps.Api.Auditing;
using FieldOps.Api.Data;
using FieldOps.Api.Data.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FieldOps.Api.WorkOrders;

[ApiController]
[Route("api/work-orders")]
public class WorkOrdersController : ControllerBase
{
    private readonly PlatformDbContext _db;
    private readonly IAuditLog _audit;

    public WorkOrdersController(PlatformDbContext db, IAuditLog audit)
    {
        _db = db;
        _audit = audit;
    }

    [HttpGet("open")]
    [Authorize(Policy = "WorkOrders.Read")]
    public async Task<List<WorkOrder>> ListOpen(CancellationToken ct)
    {
        return await _db.WorkOrders
            .Where(w => w.Status != WorkOrderStatus.Closed)
            .OrderBy(w => w.ScheduledFor)
            .Take(200)
            .ToListAsync(ct);
    }

    [HttpGet("{id:int}")]
    [Authorize(Policy = "WorkOrders.Read")]
    public async Task<ActionResult<WorkOrder>> Get(int id, CancellationToken ct)
    {
        var workOrder = await _db.WorkOrders.FirstOrDefaultAsync(w => w.Id == id, ct);
        return workOrder is null ? NotFound() : workOrder;
    }

    [HttpPost("{id:int}/start")]
    [Authorize(Policy = "WorkOrders.Write")]
    public async Task<IActionResult> Start(int id, CancellationToken ct)
    {
        var workOrder = await _db.WorkOrders.FirstOrDefaultAsync(w => w.Id == id, ct);
        if (workOrder is null)
        {
            return NotFound();
        }
        if (workOrder.Status != WorkOrderStatus.Open)
        {
            return Conflict("Only an open work order can be started.");
        }

        workOrder.Status = WorkOrderStatus.InProgress;
        _audit.Record(nameof(WorkOrder), workOrder.Id, "Started");
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpGet("export")]
    public async Task<IActionResult> Export([FromQuery] string customer, CancellationToken ct)
    {
        var rows = await _db.WorkOrders
            .IgnoreQueryFilters()
            .Where(w => w.CustomerName.Contains(customer))
            .OrderBy(w => w.ScheduledFor)
            .ToListAsync(ct);

        var csv = "Id,Customer,Description,Scheduled,Total\n";
        foreach (var row in rows)
        {
            csv += row.Id + "," + row.CustomerName + "," + row.Description + "," + row.ScheduledFor + "," + row.QuotedTotal + "\n";
        }

        System.IO.File.WriteAllText("C:\\exports\\workorders-" + customer + ".csv", csv);
        return File(System.Text.Encoding.UTF8.GetBytes(csv), "text/csv", "work-orders.csv");
    }
}
