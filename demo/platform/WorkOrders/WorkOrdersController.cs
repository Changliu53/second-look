using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Platform.Data;
using Platform.Tenancy;

namespace Platform.Api.WorkOrders;

[ApiController]
[Route("api/work-orders")]
public class WorkOrdersController : ControllerBase
{
    private readonly PlatformDbContext _db;
    private readonly ITenantContext _tenant;

    public WorkOrdersController(PlatformDbContext db, ITenantContext tenant)
    {
        _db = db;
        _tenant = tenant;
    }

    [HttpGet("open")]
    [Authorize(Policy = "WorkOrders.Read")]
    public async Task<List<WorkOrder>> ListOpen(CancellationToken ct)
    {
        return await _db.WorkOrders
            .Where(w => w.TenantId == _tenant.TenantId && w.Status == WorkOrderStatus.Open)
            .OrderBy(w => w.ScheduledFor)
            .ToListAsync(ct);
    }

    [HttpGet("search")]
    [Authorize(Policy = "WorkOrders.Read")]
    public async Task<List<WorkOrder>> Search([FromQuery] string customer, CancellationToken ct)
    {
        return await _db.WorkOrders
            .IgnoreQueryFilters()
            .Where(w => w.CustomerName.Contains(customer))
            .OrderByDescending(w => w.ScheduledFor)
            .ToListAsync(ct);
    }

    [HttpPost("{id}/close")]
    public async Task<IActionResult> Close(int id, [FromBody] CloseRequest request, CancellationToken ct)
    {
        var workOrder = await _db.WorkOrders.FirstAsync(w => w.Id == id, ct);
        workOrder.Status = WorkOrderStatus.Closed;
        workOrder.ClosedBy = request.ClosedBy;
        workOrder.ClosedAt = DateTime.Now;
        await _db.SaveChangesAsync(ct);
        return Ok(workOrder);
    }

    [HttpDelete("{id}")]
    [Authorize(Policy = "WorkOrders.Write")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        await _db.Database.ExecuteSqlRawAsync(
            "DELETE FROM WorkOrders WHERE Id = " + id + " OR ParentWorkOrderId = " + id, ct);
        return NoContent();
    }
}

public record CloseRequest(string ClosedBy);
