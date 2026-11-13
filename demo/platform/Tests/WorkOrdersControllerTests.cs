using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Platform.Api.WorkOrders;
using Platform.Data;
using Platform.Tenancy;
using Xunit;

namespace Platform.Tests;

public class WorkOrdersControllerTests
{
    private const int TenantA = 1;
    private const int TenantB = 2;

    private sealed class FixedTenant : ITenantContext
    {
        public FixedTenant(int tenantId) => TenantId = tenantId;
        public int TenantId { get; }
    }

    private static PlatformDbContext NewDatabase(string name)
    {
        var options = new DbContextOptionsBuilder<PlatformDbContext>()
            .UseInMemoryDatabase(name)
            .Options;
        return new PlatformDbContext(options);
    }

    private static async Task SeedAsync(PlatformDbContext db)
    {
        db.WorkOrders.AddRange(
            new WorkOrder { Id = 1, TenantId = TenantA, CustomerName = "Acme Water", Status = WorkOrderStatus.Open },
            new WorkOrder { Id = 2, TenantId = TenantB, CustomerName = "Acme Drilling", Status = WorkOrderStatus.Open });
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Search_returns_only_the_current_tenants_work_orders()
    {
        await using var db = NewDatabase(nameof(Search_returns_only_the_current_tenants_work_orders));
        await SeedAsync(db);
        var controller = new WorkOrdersController(db, new FixedTenant(TenantA));

        var results = await controller.Search("Acme", CancellationToken.None);

        Assert.Single(results);
        Assert.Equal(TenantA, results[0].TenantId);
    }

    [Fact]
    public async Task Delete_does_not_remove_another_tenants_work_order()
    {
        await using var db = NewDatabase(nameof(Delete_does_not_remove_another_tenants_work_order));
        await SeedAsync(db);
        var controller = new WorkOrdersController(db, new FixedTenant(TenantA));

        var result = await controller.Delete(2, CancellationToken.None);

        Assert.IsType<NotFoundResult>(result);
        Assert.Equal(2, await db.WorkOrders.CountAsync());
    }

    [Fact]
    public async Task Delete_removes_the_work_order_and_its_children_for_the_current_tenant()
    {
        await using var db = NewDatabase(nameof(Delete_removes_the_work_order_and_its_children_for_the_current_tenant));
        await SeedAsync(db);
        db.WorkOrders.Add(new WorkOrder { Id = 3, TenantId = TenantA, ParentWorkOrderId = 1 });
        await db.SaveChangesAsync();
        var controller = new WorkOrdersController(db, new FixedTenant(TenantA));

        var result = await controller.Delete(1, CancellationToken.None);

        Assert.IsType<NoContentResult>(result);
        Assert.Equal(new[] { 2 }, await db.WorkOrders.Select(w => w.Id).ToArrayAsync());
    }
}
