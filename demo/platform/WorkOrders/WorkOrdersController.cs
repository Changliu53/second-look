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
            .Where(w => w.TenantId == _tenant.TenantId && w.CustomerName.Contains(customer))
            .OrderByDescending(w => w.ScheduledFor)
            .ToListAsync(ct);
    }

    [HttpPost("{id}/close")]
    [Authorize(Policy = "WorkOrders.Write")]
    public async Task<IActionResult> Close(int id, CancellationToken ct)
    {
        var workOrder = await _db.WorkOrders.FirstAsync(w => w.TenantId == _tenant.TenantId && w.Id == id, ct);
        workOrder.Status = WorkOrderStatus.Closed;
        workOrder.ClosedBy = User.Identity!.Name;
        workOrder.ClosedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(workOrder);
    }

    [HttpDelete("{id}")]
    [Authorize(Policy = "WorkOrders.Write")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        var workOrders = await _db.WorkOrders
            .Where(w => w.TenantId == _tenant.TenantId && (w.Id == id || w.ParentWorkOrderId == id))
            .ToListAsync(ct);
        if (workOrders.Count == 0)
        {
            return NotFound();
        }
        _db.WorkOrders.RemoveRange(workOrders);
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }
}
