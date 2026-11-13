namespace FieldOps.Api.Data.Entities;

public class Customer : ITenantOwned
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string Name { get; set; } = "";
    public string? PrimaryPhone { get; set; }
    public List<Well> Wells { get; set; } = new();
}
